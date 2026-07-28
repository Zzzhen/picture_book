const ENVIRONMENT_IDS = Object.freeze({
  development: "",
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
