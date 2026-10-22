// Inline scripts for the storefront pages. Plain ES2020, no build step; the server renders
// everything static, these only load slots or stock and submit the order.

export const CHECKOUT_SCRIPT = `(() => {
  const d = JSON.parse(document.getElementById("checkout-data").textContent);
  const form = document.getElementById("checkout");
  const err = document.getElementById("error");
  const pay = document.querySelector("button[form=checkout]");
  const sum = document.getElementById("total");
  const booking = d.fulfillment === "booking";
  const yuan = (fen) => "¥" + (fen % 100 === 0 ? fen / 100 : (fen / 100).toFixed(2));
  const hhmm = (iso) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(11, 16);
  const variant = () => {
    const el = form.querySelector("input[name=variant]:checked") || form.querySelector("input[name=variant]");
    return d.variants.find((v) => v.id === el.value);
  };
  const qty = () => (booking ? 1 : Math.max(1, Math.floor(Number(form.quantity.value)) || 1));
  const total = () => { sum.textContent = yuan(variant().priceFen * qty()); };

  async function availability(date) {
    const q = new URLSearchParams({ variantId: variant().id });
    if (date) q.set("date", date);
    const res = await fetch(d.availability + "?" + q);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || "加载失败，请刷新重试");
    return body;
  }

  let day = null;
  async function loadSlots() {
    const box = document.getElementById("slots");
    form.slotStart.value = "";
    if (!day) return;
    box.innerHTML = '<span class="muted small">加载中…</span>';
    try {
      const { slots } = await availability(day);
      box.replaceChildren();
      if (slots.length === 0) {
        box.innerHTML = '<span class="muted small">这一天已约满，换一天看看</span>';
        return;
      }
      for (const s of slots) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pill";
        b.textContent = hhmm(s.start);
        b.onclick = () => {
          box.querySelectorAll(".pill").forEach((x) => x.classList.remove("on"));
          b.classList.add("on");
          form.slotStart.value = s.start;
          err.textContent = "";
        };
        box.append(b);
      }
    } catch (e) {
      box.textContent = e.message;
    }
  }

  async function loadStock() {
    const el = document.getElementById("stock");
    try {
      const { stock } = await availability();
      el.textContent = stock > 0 ? "（库存 " + stock + "）" : "（已售罄）";
      form.quantity.max = String(Math.max(1, Math.min(99, stock)));
      pay.disabled = stock <= 0;
    } catch (e) {
      el.textContent = e.message;
    }
  }

  document.querySelectorAll("[data-date]").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("[data-date]").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      day = b.dataset.date;
      loadSlots();
    };
  });
  form.addEventListener("change", (e) => {
    if (e.target.name !== "variant") return;
    total();
    booking ? loadSlots() : loadStock();
  });
  form.addEventListener("input", (e) => { if (e.target.name === "quantity") total(); });
  form.querySelectorAll("[data-step]").forEach((b) => {
    b.onclick = () => {
      const q = form.quantity;
      q.value = String(Math.min(Number(q.max) || 99, Math.max(1, qty() + Number(b.dataset.step))));
      total();
    };
  });

  // Runs only after the browser's own checks (required, pattern) pass.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    if (booking && !form.slotStart.value) {
      err.textContent = "请选择预约时间";
      return;
    }
    const options = {};
    for (const el of form.querySelectorAll("[name^='opt:']")) {
      if ((el.type === "radio" && !el.checked) || !el.value.trim()) continue;
      options[el.name.slice(4)] = el.value.trim();
    }
    const customer = { name: form.customerName.value.trim(), phone: form.phone.value.trim() };
    const order = {
      items: [{ variantId: variant().id, quantity: qty(), options }],
      customer,
      ...(booking
        ? { slotStart: form.slotStart.value }
        : { address: { recipient: customer.name, phone: customer.phone, region: form.region.value.trim(), detail: form.detail.value.trim() } }),
    };
    pay.disabled = true;
    const label = pay.textContent;
    let leaving = false;
    pay.textContent = "正在下单…";
    try {
      const res = await fetch(d.checkout, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(order) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        err.textContent = body.message || "下单失败，请稍后再试";
        if (body.error === "slot_unavailable") loadSlots();
        if (body.error === "out_of_stock") loadStock();
        return;
      }
      leaving = true;
      location.href = body.paymentUrl;
    } catch {
      err.textContent = "网络不太好，请稍后再试";
    } finally {
      if (!leaving) {
        pay.disabled = false;
        pay.textContent = label;
      }
    }
  });

  total();
  if (booking) document.querySelector("[data-date]:not([disabled])")?.click();
  else loadStock();
})();`;

// Asks before cancelling; without JS the form still works, just without the question.
export const CANCEL_SCRIPT = `(() => {
  const form = document.querySelector("form[data-confirm]");
  form.addEventListener("submit", (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
    else form.querySelector("button").disabled = true;
  });
})();`;

// Waits on an unpaid order: reloads the page once its status changes (e.g. paid in another tab).
export const ORDER_SCRIPT = `(() => {
  const url = document.getElementById("order-status").dataset.url;
  const timer = setInterval(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const { status } = await res.json();
      if (status !== "pending_payment") { clearInterval(timer); location.reload(); }
    } catch {}
  }, 3000);
})();`;
