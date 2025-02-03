const axios = require("axios");
const { log } = require("./utils"); // Adjust the path as necessary
const settings = require("./config/config");

const urlChecking = "https://raw.githubusercontent.com/zainarain279/APIs-checking/refs/heads/main/endpoints.json";

async function checkBaseUrl() {
    console.log("Checking api...".blue);
    if (settings.ADVANCED_ANTI_DETECTION) {
        const result = await getBaseApi(urlChecking);
        if (result.endpoint) {
            log("No change in api!", "success");
            return result;
        }
    } else {
        return { endpoint: settings.BASE_URL };
    }
}

async function getBaseApi(url) {
    try {
        const response = await axios.get(url);
        const content = response.data;
        if (content?.sleep) {
            return { endpoint: content.sleep };
        } else {
            return { endpoint: null };
        }
    } catch (e) {
        return { endpoint: null };
    }
}

module.exports = { checkBaseUrl };