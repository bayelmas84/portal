"use strict";
const { createApp } = require("./app");
const { config } = require("./config");

const app = createApp();
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[tera-portal] ${config.nodeEnv} modunda ${config.port} portunda dinliyor (auth: ${config.authMode})`);
});
