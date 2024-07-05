// Javascript updated 01/07/2024, 14:01:43 by Amplenote Plugin Builder from source code within "https://github.com/Capta1nCool/smart-typography/build/compiled.js"
(() => {
  // lib/plugin.js
  var plugin = {
    noteOption: {
      "Format note": {
        check: async function(app, noteUUID) {
          return true;
        },
        run: async function(app, noteUUID) {
          const replacements = {
            arrows: [
              { pattern: /<!--\s*\{.*?\}\s*-->/g, replacement: '' }, // Fix for tasks having their uuis also getting added to the result
              { pattern: /<-/g, replacement: "\u2190" },
              { pattern: /->/g, replacement: "\u2192" }
            ],
            guillemets: [
              { pattern: /<</g, replacement: "\xAB" },
              { pattern: />>/g, replacement: "\xBB" }
            ],
            comparisons: [
              { pattern: /<=/g, replacement: "\u2264" },
              { pattern: />=/g, replacement: "\u2265" },
              { pattern: /\/=/g, replacement: "\u2260" }
            ],
            ellipsis: [
              { pattern: /\.\.\./g, replacement: "\u2026" }
            ],
            fractions: [
              { pattern: /1\/2/g, replacement: '½' },
              { pattern: /1\/3/g, replacement: '⅓' },
              { pattern: /2\/3/g, replacement: '⅔' },
              { pattern: /1\/4/g, replacement: '¼' },
              { pattern: /3\/4/g, replacement: '¾' },
              { pattern: /1\/5/g, replacement: '⅕' },
              { pattern: /2\/5/g, replacement: '⅖' },
              { pattern: /3\/5/g, replacement: '⅗' },
              { pattern: /4\/5/g, replacement: '⅘' },
              { pattern: /1\/6/g, replacement: '⅙' },
              { pattern: /5\/6/g, replacement: '⅚' },
              { pattern: /1\/7/g, replacement: '⅐' },
              { pattern: /1\/8/g, replacement: '⅛' },
              { pattern: /3\/8/g, replacement: '⅜' },
              { pattern: /5\/8/g, replacement: '⅝' },
              { pattern: /7\/8/g, replacement: '⅞' },
              { pattern: /1\/9/g, replacement: '⅑' },
              { pattern: /1\/10/g, replacement: '⅒' }
            ],
            dashes: [
              { pattern: /—-(?=.)/g, replacement: '---' },
              { pattern: /–-(?=.)/g, replacement: '—' },

              { pattern: /--/g, replacement: '–' }
            ]
          };

          function replaceQuotes(inputString) {
            let outputString = '';
            let doubleQuoteOpen = true;
            let singleQuoteOpen = true;

            for (let i = 0; i < inputString.length; i++) {
              const char = inputString[i];
              if (char === '"') {
                if (doubleQuoteOpen) {
                  outputString += '“';
                } else {
                  outputString += '”';
                }
                doubleQuoteOpen = !doubleQuoteOpen;
              } else if (char === "'") {
                if (singleQuoteOpen) {
                  outputString += '‘';
                } else {
                  outputString += '’';
                }
                singleQuoteOpen = !singleQuoteOpen;

              } else {
                outputString += char;
              }
            }
            return outputString;
          }

          let markdown = await app.getNoteContent({ uuid: noteUUID });

          Object.keys(replacements).forEach((category) => {
            replacements[category].forEach((item) => {
              markdown = markdown.replace(item.pattern, item.replacement);
            });
          });

          markdown = replaceQuotes(markdown);

          await app.replaceNoteContent({ uuid: noteUUID }, markdown);
        }
      }
    }
  };
  var plugin_default = plugin;
  return plugin;
})()
