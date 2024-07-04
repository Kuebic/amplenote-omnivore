import { jest } from "@jest/globals"
import { mockAppWithContent, mockPlugin } from "./test-helpers.js"

// --------------------------------------------------------------------------------------
describe("This here plugin", () => {
  const plugin = mockPlugin();
  plugin.constants.isTestEnvironment = true;

  it("should run some tests", async () => {
    const { app, note } = mockAppWithContent(`To be, or not to be, that is the cool question`);
    expect(await plugin.noteOption["Baby's first Note Option command"].check(app, note.uuid)).toBeTruthy();
  })
});
