(() => {
  var plugin = {
    noteOption: {
      "Format Note": {
        check: async function (app, noteUUID) {
          return true;
        },
        run: async function (app, noteUUID) {
          const noteContent = await app.getNoteContent({ uuid: noteUUID });
          const formattedContent = noteContent.replace(/cool/i, "cool");
          await app.replaceNoteContent({ uuid: noteUUID, content: formattedContent });
        }
      }
    }
  }
})()
