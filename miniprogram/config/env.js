const ENVIRONMENT_IDS = Object.freeze({
  development: "cloudbase-d1gynomkl24a67b03",
  production: "",
});

const ACTIVE_ENVIRONMENT = "development";

function getEnvironmentId() {
  return ENVIRONMENT_IDS[ACTIVE_ENVIRONMENT] || "";
}

module.exports = {
  ACTIVE_ENVIRONMENT,
  ENVIRONMENT_IDS,
  getEnvironmentId,
};
