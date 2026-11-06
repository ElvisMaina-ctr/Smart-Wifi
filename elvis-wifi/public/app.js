
const packageGrid = document.getElementById("packages");
const packageInput = document.getElementById("package-id");
const payButton = document.getElementById("pay-button");
const form = document.getElementById("payment-form");
const message = document.getElementById("message");
const connection = document.getElementById("connection");

document.getElementById("year").textContent = new Date().getFullYear();

let selectedPackage = null;
let pollTimer = null;

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`;
}

async function loadPackages() {
  try {
    const response = await fetch("/api/packages");
    if (!response.ok) throw new Error("Could not load packages.");
    const packages = await response.json();

    packageGrid.replaceChildren();
    packages.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "package";
      button.innerHTML = `
        <span class="package-name">${item.name}</span>
        <span class="package-price">Ksh ${item.price}</span>
        <span class="package-description">${item.description}</span>
      `;
      button.addEventListener("click", () => {
        document.querySelectorAll(".package").forEach(el => el.classList.remove("selected"));
        button.classList.add("selected");
        selectedPackage = item;
        packageInput.value = item.id;
        payButton.disabled = false;
        payButton.textContent = `Pay Ksh ${item.price} with M-Pesa`;
        showMessage("");
      });
      packageGrid.appendChild(button);
    });
  } catch (error) {
    packageGrid.textContent = error.message;
  }
}

async function checkPayment(orderId) {
  try {
    const response = await fetch(`/api/status/${encodeURIComponent(orderId)}`);
    const data = await response.json();

    if (data.status === "active") {
      clearInterval(pollTimer);
      showMessage("Payment confirmed! Activating your internet access…", "success");
      activateHotspot(data);
    } else if (data.status === "failed" || data.status === "expired") {
      clearInterval(pollTimer);
      showMessage("Payment was not completed. Please try again.", "error");
      payButton.disabled = false;
    } else if (data.status === "paid") {
      showMessage("Payment received. Setting up your internet access…", "success");
    }
  } catch {
    showMessage("Checking payment status. Please wait…");
  }
}

function activateHotspot(data) {
  const loginUrl = new URL(data.hotspotLoginOrigin || window.location.origin);
  const expectedOrigin = data.hotspotLoginOrigin;
  const suppliedLogin = new URLSearchParams(window.location.search).get("link-login-only");

  connection.hidden = false;
  connection.replaceChildren();

  if (!suppliedLogin || !expectedOrigin) {
    connection.textContent =
      `Your payment is confirmed. Your access username is ${data.username}. ` +
      `Please open the Wi-Fi login page and enter the username and password shown by the administrator.`;
    const credentials = document.createElement("p");
    credentials.textContent = `Username: ${data.username} | Password: ${data.password}`;
    connection.appendChild(credentials);
    return;
  }

  let target;
  try {
    target = new URL(suppliedLogin);
    if (target.origin !== loginUrl.origin) throw new Error("Unexpected hotspot login address");
  } catch {
    showMessage("Payment confirmed, but automatic login could not be verified. Contact the administrator.", "error");
    connection.textContent = `Username: ${data.username} | Password: ${data.password}`;
    return;
  }

  const formElement = document.createElement("form");
  formElement.method = "post";
  formElement.action = target.href;

  const fields = {
    username: data.username,
    password: data.password,
    dst: new URLSearchParams(window.location.search).get("link-orig") || "http://neverssl.com/"
  };

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    formElement.appendChild(input);
  });

  connection.textContent = "Connecting your device to ELVIS Wi-Fi…";
  document.body.appendChild(formElement);
  formElement.submit();
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!selectedPackage) return showMessage("Please choose an internet package.", "error");

  const phone = document.getElementById("phone").value.trim();
  payButton.disabled = true;
  payButton.textContent = "Sending M-Pesa prompt…";
  connection.hidden = true;
  showMessage("Please wait. We are contacting M-Pesa…");

  try {
    const response = await fetch("/api/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, packageId: selectedPackage.id })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start payment.");

    showMessage(data.message, "success");
    pollTimer = setInterval(() => checkPayment(data.orderId), 3000);
    setTimeout(() => {
      if (pollTimer) {
        clearInterval(pollTimer);
        showMessage("We have not received confirmation yet. If you entered your PIN, wait a little and refresh this page or contact support.", "error");
        payButton.disabled = false;
        payButton.textContent = `Pay Ksh ${selectedPackage.price} with M-Pesa`;
      }
    }, 120000);
  } catch (error) {
    showMessage(error.message, "error");
    payButton.disabled = false;
    payButton.textContent = `Pay Ksh ${selectedPackage.price} with M-Pesa`;
  }
});

loadPackages();
