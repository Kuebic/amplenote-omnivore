import { CODE_HEADING, DEFAULT_BRANCH, MAX_REPLACE_CONTENT_LENGTH, ENTRY_LOCATIONS } from "./plugin-constants"
import { fileContentFromUrl, inlineImportsFromGithub, mainBlockFromEntryContent } from "./plugin-import-inliner"

const plugin = {
  //----------------------------------------------------------------------
  _constants: {
    defaultBranch: DEFAULT_BRANCH,
    codeHeading: CODE_HEADING,
    entryLocations: ENTRY_LOCATIONS,
    maxReplaceContentLength: MAX_REPLACE_CONTENT_LENGTH,
  },

  processingError: false,

  //----------------------------------------------------------------------
  insertText: {
    "Refresh": {
      check: async function(app) {
        return !!(await this._githubRepoUrl(app, { quietFail: true }));
      },
      run: async function(app, stripConsoleDebug = false) {
        this.processingError = false;
        const githubUrl = await this._githubRepoUrl(app);
        if (githubUrl) {
          await this._syncUrlToNote(app, githubUrl, stripConsoleDebug);
        } else {
          await app.alert(`Could not find a line beginning in "repo:" or "entry:" in the note.`);
        }
      }
    },
    "Sync": {
      check: async function(app) {
        const boundCheck = this.insertText["Refresh"].check.bind(this);
        return await boundCheck(app);
      },
      run: async function(app) {
        const boundRun = this.insertText["Refresh"].run.bind(this);
        return await boundRun(app);
      }
    }
  },

  //----------------------------------------------------------------------
  noteOption: {
    "Refresh": {
      check: async function(app) {
        const boundCheck = this.insertText["Refresh"].check.bind(this);
        return await boundCheck(app);
      },
      run: async function(app) {
        const boundRun = this.insertText["Refresh"].run.bind(this);
        return await boundRun(app);
      }
    },
    "Refresh minus debug": {
      check: async function(app) {
        const boundCheck = this.insertText["Refresh"].check.bind(this);
        return await boundCheck(app);
      },
      run: async function(app) {
        const boundRun = this.insertText["Refresh"].run.bind(this);
        return await boundRun(app, true);
      }
    }
  },

  //----------------------------------------------------------------------
  async _syncUrlToNote(app, repoUrl, stripConsoleDebug = false) {
    const entryPoint = await this._entryPointFromUrl(app, repoUrl);
    if (entryPoint.url) {
      const note = await app.notes.find(app.context.noteUUID);
      let noteContent = await note.content();
      if (!(await this._isAbleToSync(app, noteContent))) {
        return null;
      }

      if (!entryPoint.content) {
        console.error("Could not find a valid entry point in repo", repoUrl, "at", entryPoint.url);
        return null;
      }
      const { esbuildBlock, mainPluginBlock } = mainBlockFromEntryContent(entryPoint.content);
      let newPluginBlock;
      if (esbuildBlock) {
        newPluginBlock = esbuildBlock;
      } else {
        const constantTranslations = [];
        const functionTranslations = [];
        newPluginBlock = await inlineImportsFromGithub(this, entryPoint, mainPluginBlock, functionTranslations, constantTranslations);
      }

      if (newPluginBlock) {
        if (stripConsoleDebug) {
          newPluginBlock = newPluginBlock.replace(/^\s*(console\.debug)/gm, `// $1`);
        }
        if (newPluginBlock.length > this._constants.maxReplaceContentLength) {
          await app.alert(`The code block (length ${ newPluginBlock.length }) is too long to replace (max size ${ this._constants.maxReplaceContentLength }).` +
            `Please manually replace the code block in the note, or email support@amplenote.com to request an increase in the size of replaceContent.`)
        } else {
          newPluginBlock = `\`\`\`\n// Javascript updated ${ (new Date()).toLocaleString() } by Amplenote Plugin Builder from source code within "${ repoUrl }"\n${ newPluginBlock }\n\`\`\``;
          noteContent = await note.content(); // Could have changed if we inserted a new # Code block heading
          const replaceTarget = this._sectionFromHeadingText(this._constants.codeHeading, noteContent);
          if (replaceTarget) {
            await note.replaceContent(newPluginBlock, replaceTarget);
          }

          if (!replaceTarget || this.processingError) {
            if (replaceTarget) {
              await app.alert(`⚠️ Plugin refresh from "${ repoUrl }" completed, but errors were encountered:\n\n` + this.processingError + `\n\nPlease check your console for more details.`);
            } else {
              await app.alert(`⚠️ Plugin refresh from "${ repoUrl }" failed. Could not find "${ this._constants.codeHeading }" within note content.`);
            }
          } else {
            await app.alert(`🎉 Plugin refresh from "${ repoUrl }" succeeded at ${ (new Date()).toLocaleString() }`);
          }
        }
      } else {
        await app.alert("Could not construct a code block from the entry point URL. There may be more details in the console.")
        return null;
      }
    }
  },

  //----------------------------------------------------------------------
  _sectionFromHeadingText(headingText, noteContent, { level = 1 } = {}) {
    let headingTextInNote;
    if (noteContent.includes(headingText)) {
      headingTextInNote = headingText;
    } else {
      const headingIndex = noteContent.toLowerCase().indexOf(headingText.toLowerCase());
      if (headingIndex > 0) {
        headingTextInNote = noteContent.substring(headingIndex, headingIndex + headingText.length);
      } else {
        return null;
      }
    }

    if (headingTextInNote) {
      return { section: { heading: { text: headingTextInNote, level } } };
    } else {
      return null;
    }
  },

  //----------------------------------------------------------------------
  async _isAbleToSync(app, noteContent) {
    if (noteContent.toLowerCase().includes(this._constants.codeHeading.toLowerCase())) {
      return true;
    } else {
      if (/^```/m.test(noteContent)) {
        await app.alert(this._noSyncMessage());
        return false;
      } else {
        console.log("Adding code block heading to note");
        const note = await app.notes.find(app.context.noteUUID);
        await note.insertContent(`\n\n# ${ this._constants.codeHeading }\n\n`, { atEnd: true });
        return true;
      }
    }
  },

  //----------------------------------------------------------------------
  _noSyncMessage() {
    return `Could not sync plugin because the note already contains code but no code block heading. Please add ` +
      `an h1 heading labeled "${ this._constants.codeHeading }" above your code block and try again.\n\nOr you can just delete` +
      `the code block and run the plugin again to re-create it with a heading.`
  },

  //----------------------------------------------------------------------
  async _githubRepoUrl(app, { quietFail = false } = {}) {
    const noteContent = await app.getNoteContent({ uuid: app.context.noteUUID });
    const urlRegex = /^\s*(entry|repo)\s*[=:]\s*(https:\/\/github.com\/)?(?<organizationSlug>[\w\-_.]+)\/(?<repoSlug>[\w\-_.]+)\/?(?<entryFile>[\w\-_.\/]+\.(ts|js))?(?:$|\n|\r)/im;
    const match = noteContent.match(urlRegex);
    if (match?.groups?.organizationSlug && match?.groups?.repoSlug) {
      return `https://github.com/${ match.groups.organizationSlug }/${ match.groups.repoSlug }${ match.groups.entryFile ? `/${ match.groups.entryFile }` : "" }`

    } else {
      if (!quietFail) {
        await app.alert("Could not find a repo URL in the note. Please include a line that begins with 'repo:' and has the URL of repo to sync");
      }
      return null;
    }
  },

  //----------------------------------------------------------------------
  /** Details about the entry point for this repo
   * @param {string} app
   * @param {string} repoOrFileUrl - URL to a Github repo or a file in a Github repo
   * @returns {object} - { content: string, url: string }
   */
  async _entryPointFromUrl(app, repoOrFileUrl) {
    if (!repoOrFileUrl) {
      throw new Error("Missing repoUrl");
    }

    let content, url;
    if (/\.(js|ts)$/.test(repoOrFileUrl)) {
      let path = repoOrFileUrl.replace("https://github.com/", "");
      const components = path.split("/");
      if (components.length >= 3) {
        url = `https://github.com/${ components[0] }/${ components[1] }/${ this._constants.defaultBranch }/${ components.slice(2).join("/") }`;
        content = await fileContentFromUrl(url);
        if (!content) {
          await app.alert(`Could not find a valid Github file at the entry point URL "${ url }" (derived from "${ repoOrFileUrl }")`);
          url = null;
        }
      } else {
        // Perhaps the user is using a non-standard branch name? We might want to make that configurable?
        await app.alert(`Could not parse a valid Github file at "${ repoOrFileUrl }"`);
      }
    } else {
      for (const entryLocation of this._constants.entryLocations) {
        url = `${ repoOrFileUrl }/${ this._constants.defaultBranch }/${ entryLocation }`;
        content = await fileContentFromUrl(url);
        if (content) {
          break;
        } else {
          url = null;
        }
      }

      if (!url) {
        await app.alert(`Could not find any entry point file in the given repo "${ repoOrFileUrl }". Please add a "plugin.js" file to the repo, or specify the location of your entry file with the "entry:" directive. \n\nSee plugin instructions for more detail.`)
      }
    }

    return { content, url };
  },

}
export default plugin;
