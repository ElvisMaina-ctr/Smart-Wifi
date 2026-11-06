
const axios = require("axios");

function config() {
  const baseURL = process.env.MIKROTIK_BASE_URL;
  const username = process.env.MIKROTIK_USERNAME;
  const password = process.env.MIKROTIK_PASSWORD;

  if (!baseURL || !username || !password) {
    throw new Error("MikroTik REST settings are missing in .env");
  }

  return axios.create({
    baseURL: `${baseURL.replace(/\/$/, "")}/rest`,
    auth: { username, password },
    headers: { "Content-Type": "application/json" },
    timeout: 10000
    // For production, install a trusted TLS certificate on RouterOS.
    // Do not disable TLS certificate verification in production.
  });
}

async function createHotspotUser(username, password, durationSeconds, comment) {
  const api = config();
  const duration = `${Math.max(1, Math.floor(durationSeconds / 60))}m`;

  await api.put("/ip/hotspot/user", {
    name: username,
    password,
    profile: process.env.MIKROTIK_HOTSPOT_PROFILE || "default",
    "limit-uptime": duration,
    comment
  });
}

async function removeHotspotUser(username) {
  const api = config();
  const response = await api.get("/ip/hotspot/user", {
    params: { ".proplist": ".id,name", name: username }
  });

  const users = Array.isArray(response.data) ? response.data : [];
  const user = users.find(item => item.name === username);

  if (user && user[".id"]) {
    await api.delete(`/ip/hotspot/user/${encodeURIComponent(user[".id"])}`);
  }
}

module.exports = { createHotspotUser, removeHotspotUser };
