
const axios = require("axios");

const host = process.env.MPESA_ENV === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function accessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error("Daraja credentials are missing");
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");

  const response = await axios.get(
    `${host}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` }, timeout: 15000 }
  );
  return response.data.access_token;
}

function normalizePhone(input) {
  let phone = String(input || "").replace(/[\\s+()-]/g, "");
  if (phone.startsWith("0")) phone = "254" + phone.slice(1);
  if (phone.startsWith("7") || phone.startsWith("1")) phone = "254" + phone;
  if (!/^254[17]\\d{8}$/.test(phone)) {
    throw new Error("Enter a valid Kenyan Safaricom number, e.g. 07XXXXXXXX");
  }
  return phone;
}

async function stkPush({ phone, amount, orderId }) {
  const token = await accessToken();
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const time = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${time}`).toString("base64");

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: time,
    TransactionType: process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: shortcode,
    PhoneNumber: phone,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: `ELVIS-${orderId.slice(0, 8)}`,
    TransactionDesc: "ELVIS Wi-Fi access"
  };

  const response = await axios.post(
    `${host}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
  );
  return response.data;
}

module.exports = { stkPush, normalizePhone };
