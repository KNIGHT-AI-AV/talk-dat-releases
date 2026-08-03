import { commerceConfig } from "./commerce-config.js";

const byId = (id) => document.getElementById(id);
const status = byId("accountStatus");
const email = byId("accountEmail");
const password = byId("accountPassword");
const passwordLabel = password.closest("label");
const deviceCode = byId("deviceCode");
const signInButton = byId("accountSignIn");
const createButton = byId("accountCreate");
const resetButton = byId("accountReset");
const signOutButton = byId("accountSignOut");
const trialButton = byId("startTrial");
const monthlyButton = byId("buyMonthly");
const annualButton = byId("buyAnnual");
const lifetimeButton = byId("buyLifetime");
const billingButton = byId("manageBilling");
const approveButton = byId("approveDevice");
const entitlementTitle = byId("entitlementTitle");
const entitlementDetail = byId("entitlementDetail");
const checkoutAvailability = byId("checkoutAvailability");
const controls = [signInButton, createButton, resetButton, signOutButton, trialButton, monthlyButton, annualButton, lifetimeButton, billingButton, approveButton];
const configValid = Boolean(commerceConfig.enabled && commerceConfig.apiBase && commerceConfig.firebase?.apiKey);
let auth;
let currentUser;
let firebaseAuth;

function setStatus(message, error = false) {
  status.textContent = message;
  status.style.color = error ? "var(--ember)" : "var(--gold)";
}

function friendlyError(error) {
  const code = String(error?.code || error?.message || "");
  if (code.includes("email-already-in-use")) return "That email already has an account. Sign in instead.";
  if (code.includes("invalid-credential")) return "The email or password did not match.";
  if (code.includes("weak-password")) return "Use a stronger password with at least eight characters.";
  if (code.includes("verified_email_required")) return "Verify your email, then return and sign in again.";
  if (code.includes("device_code")) return String(error.message || "The PC activation code expired. Start again in Talk Dat!.");
  return String(error?.message || "The secure account action could not finish.").replace(/^Firebase:\s*/i, "");
}

async function api(path, body = undefined) {
  if (!currentUser) throw new Error("Sign in first.");
  const token = await currentUser.getIdToken(true);
  const response = await fetch(`${commerceConfig.apiBase.replace(/\/$/, "")}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "omit"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || "Account request failed.");
    error.code = payload.error || "account_error";
    throw error;
  }
  return payload;
}

function renderEntitlement(value) {
  const plan = value?.plan || "none";
  const active = Boolean(value?.active);
  entitlementTitle.textContent = plan === "lifetime" ? "Lifetime access" : plan === "pro" ? (active ? "Talk Dat! Pro" : "Pro needs attention") : plan === "trial" ? (active ? "Trial active" : "Trial ended") : "No trial or purchase yet";
  if (plan === "trial" && value.trialEndsAt) {
    entitlementDetail.textContent = `${active ? "Trial ends" : "Trial ended"} ${new Date(value.trialEndsAt).toLocaleDateString()}. Activate up to ${value.maxDevices || 3} PCs.`;
  } else if (plan === "lifetime") {
    entitlementDetail.textContent = `Core dictation is yours permanently. ${value.deviceCount || 0} of ${value.maxDevices || 3} PC activations used.`;
  } else if (plan === "pro") {
    const renewal = value.subscriptionEndsAt ? new Date(value.subscriptionEndsAt).toLocaleDateString() : "your next billing date";
    entitlementDetail.textContent = `${active ? "Pro is active" : "Pro is not active"} on the ${value.billingPeriod || "monthly"} plan through ${renewal}. ${value.deviceCount || 0} of ${value.maxDevices || 3} PC activations used.`;
  } else {
    entitlementDetail.textContent = "Start the no-card trial, subscribe to Pro, or purchase lifetime access.";
  }
  trialButton.disabled = !currentUser || !currentUser.emailVerified || plan !== "none";
  monthlyButton.disabled = !currentUser || !currentUser.emailVerified || plan === "lifetime" || (plan === "pro" && active);
  annualButton.disabled = !currentUser || !currentUser.emailVerified || plan === "lifetime" || (plan === "pro" && active);
  lifetimeButton.disabled = !currentUser || !currentUser.emailVerified || plan === "lifetime";
  billingButton.disabled = !currentUser || !currentUser.emailVerified || !["pro", "lifetime"].includes(plan);
  approveButton.disabled = !currentUser || !currentUser.emailVerified || !deviceCode.value.trim();
}

async function refreshAccount() {
  if (!currentUser) return renderEntitlement(null);
  await firebaseAuth.reload(currentUser);
  if (!currentUser.emailVerified) {
    setStatus(`Signed in as ${currentUser.email}. Verify the email before starting a trial or buying.`);
    return renderEntitlement(null);
  }
  setStatus(`Signed in as ${currentUser.email}.`);
  try {
    renderEntitlement(await api("/v1/entitlements/me"));
  } catch (error) {
    setStatus(friendlyError(error), true);
  }
}

async function run(action) {
  controls.forEach((control) => { control.disabled = true; });
  try {
    await action();
  } catch (error) {
    setStatus(friendlyError(error), true);
  } finally {
    await refreshAccount();
  }
}

function credentials() {
  const value = email.value.trim();
  if (!value || password.value.length < 8) throw new Error("Enter an email and a password with at least eight characters.");
  return { email: value, password: password.value };
}

if (!configValid) {
  controls.forEach((control) => { control.disabled = true; });
  setStatus("Secure trial and checkout are not live yet. The verified Windows beta download remains available.");
  checkoutAvailability.textContent = "Pro and Founder checkout are not live yet. No purchase or remaining-license count is shown until Stripe and the signed entitlement service are verified.";
} else {
  const [{ initializeApp }, authModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js")
  ]);
  firebaseAuth = authModule;
  const app = initializeApp(commerceConfig.firebase);
  auth = firebaseAuth.getAuth(app);
  firebaseAuth.onAuthStateChanged(auth, (user) => {
    currentUser = user;
    signInButton.hidden = Boolean(user);
    createButton.hidden = Boolean(user);
    resetButton.hidden = Boolean(user);
    signOutButton.hidden = !user;
    email.disabled = Boolean(user);
    password.hidden = Boolean(user);
    if (passwordLabel) passwordLabel.hidden = Boolean(user);
    if (user) email.value = user.email || "";
    void refreshAccount();
  });

  signInButton.addEventListener("click", () => run(async () => {
    const value = credentials();
    await firebaseAuth.signInWithEmailAndPassword(auth, value.email, value.password);
  }));
  createButton.addEventListener("click", () => run(async () => {
    const value = credentials();
    const result = await firebaseAuth.createUserWithEmailAndPassword(auth, value.email, value.password);
    await firebaseAuth.sendEmailVerification(result.user);
    setStatus("Account created. Check your email to verify it.");
  }));
  resetButton.addEventListener("click", () => run(async () => {
    const value = email.value.trim();
    if (!value) throw new Error("Enter your email first.");
    await firebaseAuth.sendPasswordResetEmail(auth, value);
    setStatus("Password reset email sent.");
  }));
  signOutButton.addEventListener("click", () => run(() => firebaseAuth.signOut(auth)));
  trialButton.addEventListener("click", () => run(async () => renderEntitlement(await api("/v1/trial/start", {}))));
  const beginCheckout = (plan) => run(async () => {
    const requestId = crypto.randomUUID().replaceAll("-", "");
    const checkout = await api("/v1/checkout", { requestId, plan });
    if (!checkout.url) throw new Error("Secure checkout did not return a destination.");
    window.location.assign(checkout.url);
  });
  monthlyButton.addEventListener("click", () => beginCheckout("pro_monthly"));
  annualButton.addEventListener("click", () => beginCheckout("pro_annual"));
  lifetimeButton.addEventListener("click", () => beginCheckout("lifetime"));
  billingButton.addEventListener("click", () => run(async () => {
    const portal = await api("/v1/billing-portal", {});
    if (!portal.url) throw new Error("Secure billing management did not return a destination.");
    window.location.assign(portal.url);
  }));
  approveButton.addEventListener("click", () => run(async () => {
    const code = deviceCode.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error("Enter the eight-character code shown by Talk Dat!.");
    renderEntitlement(await api("/v1/device/approve", { userCode: code }));
    setStatus("This PC is approved. Return to Talk Dat! to finish activation.");
  }));
  deviceCode.addEventListener("input", () => {
    deviceCode.value = deviceCode.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8).replace(/(.{4})(.+)/, "$1-$2");
    approveButton.disabled = !currentUser?.emailVerified || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(deviceCode.value);
  });
  const codeFromApp = new URLSearchParams(window.location.search).get("device_code");
  if (codeFromApp) {
    deviceCode.value = codeFromApp.toUpperCase().slice(0, 9);
    window.location.hash = "account";
  }
}
