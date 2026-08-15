const { YouTubeAutomationSetup } = require('../setup');

(async () => {
  try {
    const setup = new YouTubeAutomationSetup();
    await setup.createDirectories();
    await setup.initializeDatabase();
    await setup.createEnvironmentFile();
    await setup.createStartupScripts();
    await setup.createSampleContent();
    console.log("\n🚀 [SUCCESS] YouTube Automation Agent initialized programmatically!");
  } catch (error) {
    console.error("\n❌ [ERROR] Initialization failed:", error);
    process.exit(1);
  }
})();
