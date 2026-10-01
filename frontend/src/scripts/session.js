import { apiFetch, getAuthToken, clearSession } from './utils.js';

export const ROL = {
  ADMIN: 'Administrador',
  GERENTE: 'Rol_gerente',
  ANALISTA: 'Rol_analista',
};
const ALL = Object.values(ROL);

// Matriz de acceso. Gana el prefijo más largo que coincida.
export const ROUTES = [
  ['/admin/configuracion', [ROL.ADMIN]],                        // gestión users/roles → solo admin
  ['/geoportal/config',    [ROL.ADMIN,ROL.ANALISTA]],                        // gestión users/roles → solo admin
  ['/admin',               [ROL.ADMIN, ROL.GERENTE]],           // admin.astro + acompañantes
  ['/hub',                 [ROL.ADMIN, ROL.ANALISTA]],          // hub + acompañantes
  ['/geoportal',           [ROL.ADMIN, ROL.ANALISTA, ROL.GERENTE]], // geoportal (agregado gerente)
  ['/showroom',            ALL],                                // todos
];

// Pantalla de inicio por rol (debe ser una ruta permitida para ese rol).
export const HOME = {
  [ROL.ADMIN]: '/hub',
  [ROL.GERENTE]: '/admin',
  [ROL.ANALISTA]: '/hub',
};

const norm = (p) => p.replace(/\/+$/, '') || '/';

export function rolesFor(pathname) {
  const p = norm(pathname);
  let best = null;
  for (const [prefix, roles] of ROUTES) {
    if ((p === prefix || p.startsWith(prefix + '/')) && (!best || prefix.length > best[0].length)) {
      best = [prefix, roles];
    }
  }
  return best ? best[1] : null; // null = sin restricción de rol
}

export function canAccess(pathname, rol) {
  const roles = rolesFor(pathname);
  return roles === null || roles.includes(rol);
}

function applyUser(user) {
  // Hub (.hub-*) y topbar del geoportal / analista (.u-name, .u-role, .avatar)
  const nombre = user.nombre || '';
  const apellido = user.apellido || '';
  const fullName = `${nombre} ${apellido}`.trim();
  const iniciales = `${nombre[0] || ''}${apellido[0] || ''}`.toUpperCase();

  document.querySelectorAll('.hub-u-name, .user-chip .u-name').forEach((el) => {
    el.textContent = fullName;
  });
  document.querySelectorAll('.hub-u-role, .user-chip .u-role').forEach((el) => {
    el.textContent = user.cargo || user.rol;
  });
  document.querySelectorAll('.hub-avatar, .user-chip .avatar').forEach((el) => {
    el.textContent = iniciales;
  });
}

// Oculta enlaces a rutas que el rol no puede usar; "/hub" pasa a apuntar a su inicio.
function applyLinks(rol) {
  document.querySelectorAll('a[href^="/"]').forEach((a) => {
    const path = a.getAttribute('href').split(/[?#]/)[0];
    if (canAccess(path, rol)) return;
    if (norm(path) === '/hub') a.setAttribute('href', HOME[rol]);
    else a.style.display = 'none';
  });
}

function showBanner(text) {
  const b = document.createElement('div');
  b.textContent = text;
  b.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 16px;background:#fef2f2;color:#991b1b;font-size:.9rem;text-align:center';
  document.body.prepend(b);
}

export async function initSession() {
  if (!getAuthToken()) {
    clearSession();
    location.replace('/login');
    return;
  }

  let res;
  try {
    res = await apiFetch('/api/me');
  } catch {
    showBanner('No se pudo contactar con el servidor.');
    return;
  }

  if (res.status === 401) return; // apiFetch ya limpió sesión y redirigió
  if (!res.ok) {
    showBanner(`No se pudo verificar tu sesión (${res.status}).`);
    return;
  }

  const user = await res.json();
  if (!ALL.includes(user.rol)) {
    clearSession();
    location.replace('/login');
    return;
  }
  if (!canAccess(location.pathname, user.rol)) {
    location.replace(HOME[user.rol]);
    return;
  }

  window.currentUser = user;
  applyUser(user);
  applyLinks(user.rol);
  document.dispatchEvent(new CustomEvent('session:ready', { detail: user }));
}

if (typeof document !== 'undefined') initSession();