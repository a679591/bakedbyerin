// ── Baked by Erin – Shared Cart Logic ──────────────────────────────────────

const CART_KEY = 'bakedByErinCart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function addToCart(id, name, price, priceLabel) {
  const cart = getCart();
  const existing = cart.find(i => i.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id, name, price, priceLabel, qty: 1 });
  }
  saveCart(cart);
  updateCartBadge();
  showAddedToast(name);
}

function removeFromCart(id) {
  saveCart(getCart().filter(i => i.id !== id));
  updateCartBadge();
}

function updateQty(id, delta) {
  const cart = getCart();
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    saveCart(cart.filter(i => i.id !== id));
  } else {
    saveCart(cart);
  }
  updateCartBadge();
}

function cartTotal() {
  return getCart().reduce((sum, i) => sum + (i.price * i.qty), 0);
}

function cartCount() {
  return getCart().reduce((sum, i) => sum + i.qty, 0);
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  const count = cartCount();
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function showAddedToast(name) {
  const existing = document.getElementById('cart-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'cart-toast';
  toast.textContent = `✓ ${name} added to cart`;
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #8b4513; color: white; padding: 12px 24px; border-radius: 8px;
    font-weight: 600; font-size: 0.9rem; z-index: 9999;
    animation: toastIn 0.3s ease; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// Hamburger nav toggle
function initNav() {
  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');
  if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => navMenu.classList.toggle('active'));
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => navMenu.classList.remove('active'));
    });
  }
  updateCartBadge();
}

document.addEventListener('DOMContentLoaded', initNav);
