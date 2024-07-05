import { TEST_USER_AGENT } from "./plugin-constants.js"

export function mainBlockFromEntryContent(content) {
  if (content) {
    console.log("Found", content.length, "sized content to parse into block");
  } else {
    console.error("No content found in block to import");
    return {};
  }

  content = content.trim();
  if (content.split("\n")[0].includes("(() => {") && /}\)\(\);$/.test(content)) {
    console.debug("Content matches esbuildBlock");
    const esbuildBlock = content.replace(/}\)\(\);$/, "  return plugin;\n})()");
    return { esbuildBlock };
  } else {
    console.debug("No esbuildBlock match found. Parsing content as standard block");
    const mainPluginBlock = content.match(/=[\s]*(\{\n[\S\s]*\n\})/)?.at(1);
    return { mainPluginBlock };
  }
}

//----------------------------------------------------------------------
/** Recursively process file contents, building a set of functionTranslations that indicates what the names of
 * functions are becoming as they migrate from their original location into the single code block that is returned
 * by this method
 * @param {object} plugin - The plugin object
 * @param {object} entryPoint - { content: string, url: string }
 * @param {string} codeBlockString - A string for a block of code that is being constructed to insert into plugin note
 * @param {array} functionTranslations - Array of functions that have been inlined so far
 * @param {array} constantTranslations - Array of constants that have been inlined so far
 * @returns {string} - Code block text that incorporates inlined versions of all functions recursively linked from the entry point
 */
export async function inlineImportsFromGithub(plugin, entryPoint, codeBlockString, functionTranslations, constantTranslations) {
  const { content, url } = entryPoint;
  if (!content) return null;

  const extension = url.split(".").pop();
  const importUrls = importUrlsFromContent(plugin, content, extension, url);

  if (!importUrls.length) {
    console.log("No import URLs found in", url);
    return codeBlockString;
  }

  // Grab constants from within the main entry point file
  await constantDeclarationsFromFileContent(plugin, content, constantTranslations);

  // Ensure that final closing brace in the object is followed by a comma so we can add more after it
  const codeWithoutFinalBrace = codeBlockString.substring(0, codeBlockString.lastIndexOf("}"));
  const finalBrace = codeWithoutFinalBrace.lastIndexOf("}");
  if (finalBrace === -1) throw new Error("Could not find any functions in code block");
  if (codeBlockString[finalBrace + 1] !== ",") {
    codeBlockString = codeBlockString.substring(0, finalBrace + 1) + "," + codeBlockString.substring(finalBrace + 1);
  }

  // Process each importUrl mentioned in the entryPoint.content
  for (const importUrl of importUrls) {
    // Returns { [functionName]: [functionCode minus leading "export"], ... }
    if (functionTranslations.find(translation => translation.importUrl === importUrl)) {
      console.log("Skipping", importUrl, "because it was already inlined");
      continue;
    }
    const importFileContent = await fileContentFromUrl(importUrl);
    if (importFileContent) {
      console.info("Received", importFileContent.length, "bytes from", importUrl, " Now processing its constants & functions...");
    } else {
      plugin.processingError = "No file content found";
      console.error("No file content found for", importUrl, "in", url);
      continue;
    }

    const functionBlocks = await functionBlocksFromFileContent(plugin, importFileContent);
    if (functionBlocks) {
      codeBlockString = codeBlockFromFunctionBlocks(plugin, codeBlockString, functionBlocks, functionTranslations, importUrl);
    }

    // If the function we're inlining mentioned another function that was inlined, ensure we update those calls
    functionTranslations.forEach(translation => {
      // First, replace all function names with the inlined version and add "this."
      // The (?<!_) negative lookahead is to prevent us from double-replacing functions, by not replacing function
      // names preceded by an underscore (as our new function names are)
      // We also make sure to not replace functions called as a field of an object by excluding the matches that
      // have a dot "." character behind the function name
      const replaceIndependentFunctionRegex = new RegExp(`(?<![\\_\\.])\\b${ translation.functionName }\\b`, "g");
      codeBlockString = codeBlockString.replace(replaceIndependentFunctionRegex, `this.${ translation.newFunctionName }`);
    });

    // Get constant translations from within the importUrl file
    await constantDeclarationsFromFileContent(plugin, importFileContent, constantTranslations);

    constantTranslations.forEach(translation => {
      const replaceConstantRegex = new RegExp(`(?<![\\_\\.])\\b${ translation.constantName }`, "g");
      const formattedConstantValue = translation.constantValue.replace(/\n/g, " ").replace(/\s{2,1000}/g, " ");
      codeBlockString = codeBlockString.replace(replaceConstantRegex, formattedConstantValue);
    });

    // Recurse to check if entryPoint.content has imports of its own to inline
    const newEntryPoint = { url: importUrl, content: importFileContent };
    codeBlockString = await inlineImportsFromGithub(plugin, newEntryPoint, codeBlockString, functionTranslations, constantTranslations);

    console.debug("Successfully finished processing", importUrl)
  }

  return codeBlockString;
}

//----------------------------------------------------------------------
export async function fetchWithRetry(url, { retries = 2, gracefulFail = false } = {}) {
  const timeoutSeconds = 30; // this._constants.requestTimeoutSeconds;
  let error;
  const apiURL = new URL(`https://plugins.amplenote.com/cors-proxy`);
  // As of April 2024, for GH to return usable content we need to convert URLs of the form
  // https://plugins.amplenote.com/cors-proxy?apiurl=https%3A%2F%2Fgithub.com%2Falloy-org%2Fai-plugin%2Fblob%2Fmain%2Fbuild%2Fcompiled.js
  // to
  // https://plugins.amplenote.com/cors-proxy?apiurl=https%3A%2F%2Fraw.githubusercontent.com%2Falloy-org%2Fai-plugin%2Fmain%2Fbuild%2Fcompiled.js
  url = url.replace("/github.com", "/raw.githubusercontent.com")
  apiURL.searchParams.set("apiurl", url);

  for (let i = 0; i < retries; i++) {
    try {
      let timeoutId;
      const controller = new AbortController();
      const signal = controller.signal;
      let headers = { "Content-Type": "text/plain", "Cache-Control": "max-age=0" };
      if (typeof(global) === "object") {
        headers["User-Agent"] = TEST_USER_AGENT;
        headers["Origin"] = "https://plugins.amplenote.com";
        console.log("Detected test environment. Off to fetch", apiURL.toString(), "with headers", headers);
      }
      const fetchPromise = fetch(apiURL, {
        cache: "no-store",
        method: "GET",
        headers
      });

      const timeoutPromise = new Promise((_, reject) =>
        timeoutId = setTimeout(() => {
          controller.abort(); // Abort fetch if timeout occurs
          reject(new Error('Timeout'));
        }, timeoutSeconds * 1000)
      );

      let result = await Promise.race([ fetchPromise, timeoutPromise ]);
      clearTimeout(timeoutId);
      return result;
    } catch (e) {
      if (gracefulFail) {
        console.log(`Failed to grab ${ url }`, e, `at ${ new Date() }. Oh well, moving on...`);
      } else {
        error = e;
        console.error(`Fetch attempt ${ i + 1 } failed with`, e, `at ${ new Date() }. Retrying...`);
      }
    }
  }

  return null;
}

//----------------------------------------------------------------------
/** Collect code blocks for a given import statement
 * @param {string} fileContent - URL of the file whose exported objects will be captured
 * @returns {object|null} - { [functionName]: [function code block, starting where function or variable is declared], ... }
 */
async function functionBlocksFromFileContent(plugin, fileContent) {
  let result = {};
  const functionRegex = /^(?:export\s+)?((?:async\s+)?function\s*(\*)?\s*(?<functionName>[^\s\(]+)\s*\(|(?:const|let)\s+(?<variableName>[^\s=]+)\s*=\s*(?:async)?\s*(?:\(\)|\((?<variableParams>[^)]+)\))\s*=>)/gm;

  const functionCodeDeclarations = Array.from(fileContent.matchAll(functionRegex));
  for (const functionDeclarationMatch of functionCodeDeclarations) {
    try {
      if (Number.isInteger(functionDeclarationMatch?.index)) {
        const functionStartIndex = functionDeclarationMatch.index;
        const remainingContent = fileContent.substring(functionStartIndex);
        const blockEndMatch = remainingContent.match(/^}\)?;?\s*(\n|$)/m);

        if (blockEndMatch?.index) {
          const functionEndIndex = functionStartIndex + blockEndMatch.index + 1;
          const functionBlock = fileContent.substring(functionStartIndex, functionEndIndex);
          const functionName = functionDeclarationMatch.groups?.functionName || functionDeclarationMatch.groups?.variableName;
          const newFunctionBlock = functionBlock.replace(/export\s+/, "");
          result[functionName] = newFunctionBlock;
        }
      }
    } catch (e) {
      plugin.processingError = "Failed to process function declaration";
      console.error("Failed to process function declaration", functionDeclarationMatch, "with", e);
    }
  }

  return result;
}

//----------------------------------------------------------------------
// Intentionally mixing const-based function declaration for a better test when we inception plugin.test.js
// The method name `fileContentFromUrl` is checked for in test. If changing it, be a pal & change it there too?
export const fileContentFromUrl = async (url) => {
  let fileContent;
  const moduleFetchResponse = await fetchWithRetry(url, { retries: 1, gracefulFail: true });
  if (moduleFetchResponse?.ok && (fileContent = await moduleFetchResponse.text())) {
    return fileContent;
  } else {
    console.log("Failed to fetch", url, "with", moduleFetchResponse);
    return null;
  }
}

//----------------------------------------------------------------------
function importUrlsFromContent(plugin, content, extension, contentFileUrl) {
  let match;
  const importUrls = [];
  const importRegex = /import\s+\{\s*([^}]+)\s*}\s+from\s+['"]([^'"]+)['"]/mg;

  while ((match = importRegex.exec(content)) !== null) {
    let importUrl = "";
    try {
      importUrl = match[2];
      if (importUrl.startsWith("./")) {
        // Grab all of the URL up to the file, which will be replaced by the file we're importing
        importUrl = `${ contentFileUrl.split("/").slice(0, -1).join("/") }/${ importUrl.replace("./", "") }`;
      } else {
        // slice(0, 7) is the URL up through the branch e.g., https://github.com/alloy-org/plugin-builder/blob/main
        const baseUrl = contentFileUrl.split("/").slice(0, 7).join("/");
        importUrl = `${ baseUrl }/${ importUrl }`;
      }
      if (!/\.[jt]s$/.test(importUrl)) {
        importUrl += `.${ extension }`;
      }
      importUrls.push(importUrl);
    } catch (e) {
      plugin.processingError = "Failed to parse importUrl: " + importUrl;
      console.error("Failed to parse import URL", importUrl, "from", contentFileUrl, "with", e, "Match had been", match);
    }
  }
  return importUrls;
}

//----------------------------------------------------------------------
// Translate functionBlock entries into new function definitions and insert them into the codeBlockString
// @param {string} importUrl - URL of the file whose exported objects will be captured
function codeBlockFromFunctionBlocks(plugin, codeBlockString, functionBlocks, functionTranslations, importUrl) {
  for (let [ functionName, functionBlock ] of Object.entries(functionBlocks)) {
    try {
      const functionLines = functionBlock.split("\n");
      const firstLine = functionLines[0];
      const paramStartPos = firstLine.indexOf("(");
      let paramsTraversePos = paramStartPos + 1;
      let paramEndPos = null, paramCount = 1;
      while (paramsTraversePos < functionBlock.length) {
        const char = functionBlock[paramsTraversePos];
        if (char === "(") {
          paramCount += 1;
        } else if (char === ")") {
          paramCount -= 1;
          if (paramCount === 0) {
            paramEndPos = paramsTraversePos;
            break;
          }
        }
        paramsTraversePos += 1;
      }
      const definition = functionBlock.substring(0, paramEndPos + 1);
      // Check if the function is async
      const isAsync = /\basync\b/.test(definition);
      // Check if the function is a generator
      const isGenerator = /function\s*\*\s*/.test(definition);
      const params = functionBlock.substring(paramStartPos + 1, paramEndPos).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      const urlSegments = importUrl.split("/");
      const newFunctionName = `_inlined_${ urlSegments[urlSegments.length - 1].replace(/[^\w]/g, "_") }_${ functionName }`;
      functionTranslations.push({ functionName, newFunctionName, importUrl });
      // Create the new function definition, including the asterisk if it's a generator
      const newDefinition = `${ isAsync ? "async " : "" }${ isGenerator ? "*" : "" }${ newFunctionName }(${ params })`;

      let newFunctionBlock = functionBlock.replace(definition, newDefinition).split("\n").map(line => `  ${ line }`).join("\n");
      newFunctionBlock = `\n  // --------------------------------------------------------------------------------------` +
        `\n  ${ newFunctionBlock.trim() }${ newFunctionBlock.trim().endsWith(",") ? "" : "," }\n`;

      const endBracket = codeBlockString.lastIndexOf("}");
      codeBlockString = codeBlockString.substring(0, endBracket) + newFunctionBlock + codeBlockString.substring(endBracket);
    } catch (e) {
      plugin.processingError = "Function import failed for " + functionName;
      console.error("Failed to process function ", functionName, "block", functionBlock, "with", e);
    }
  }

  return codeBlockString;
}

//----------------------------------------------------------------------
async function constantDeclarationsFromFileContent(plugin, fileContent, constantTranslations)  {
  const constantRegex = /^(?:export\s+)?\s*(?:const|let|var)\s+(?<constantName>[A-Z][A-Z0-9_]*)\s*=[\s\b]+(?<constantValueStart>[\[{("'0-9])/gm;

  const constantDeclarations = Array.from(fileContent.matchAll(constantRegex));
  for (const constantDeclarationMatch of constantDeclarations) {
    try {
      if (Number.isInteger(constantDeclarationMatch?.index) && constantDeclarationMatch.groups?.constantValueStart) {
        const constantStartIndex = constantDeclarationMatch.index;
        const constantAdjacentText = fileContent.substring(constantStartIndex);
        const startIndex = constantAdjacentText.indexOf(constantDeclarationMatch.groups?.constantValueStart);
        let endIndex;
        if (/[0-9]/.test(constantDeclarationMatch.groups?.constantValueStart)) {
          endIndex = startIndex + constantAdjacentText.substring(startIndex).search(/[^0-9]/) - 1;
        } else {
          const endCharacter = { "(": ")", "{": "}", '"': '"', "'": "'", "[": "]" }[constantDeclarationMatch.groups?.constantValueStart];
          const endOffset = constantAdjacentText.substring(startIndex + 1).indexOf(endCharacter);
          endIndex = startIndex + endOffset + 1;
        }

        if (endIndex !== -1 && startIndex !== -1) {
          const constantValue = constantAdjacentText.substring(startIndex, endIndex + 1);
          const constantName = constantDeclarationMatch.groups?.constantName;
          constantTranslations.push({ constantName, constantValue });
        }
      }
    } catch (e) {
      plugin.processingError = "Constant import failed";
      console.error("Failed to process constant declaration", constantDeclarationMatch, "with", e);
    }
  }
}

// Used by plugin test
function littleTest() {
  if (true) console.debug("cool");
  console.debug("neat");
}
