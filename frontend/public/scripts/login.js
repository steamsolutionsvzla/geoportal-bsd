// ============================================================
// Login · Geoportal BSD
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // ---- 1. Si ya hay sesión, redirigir al geoportal ----
  // Descomenta esto SOLO en producción.
  // if (Auth.isLoggedIn()) {
  //   window.location.href = '/geoportal';
  //   return;
  // }

  // ---- 2. Referencias al DOM ----
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const togglePassword = document.getElementById('togglePassword');
  const btnLogin = document.getElementById('btnLogin');
  const spinner = document.getElementById('spinner');
  const alertBox = document.getElementById('alertBox');

  if (!form || !emailInput || !passwordInput || !btnLogin) return;

  // ---- 3. Glow del botón que sigue al mouse ----
  btnLogin.addEventListener('mousemove', (e) => {
    const rect = btnLogin.getBoundingClientRect();
    btnLogin.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
    btnLogin.style.setProperty('--my', (e.clientY - rect.top) + 'px');
  });

  // ---- 4. Mostrar / ocultar contraseña ----
  if (togglePassword) {
    togglePassword.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePassword.textContent = isPassword ? '🙈' : '👁';
      togglePassword.setAttribute(
        'aria-label',
        isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
      );
    });
  }

  // ---- 5. Helpers de validación / UI ----
  const validarLogin = (valor) =>
    /^[^\s@]+@[^\s@]+(\.[^\s@]+)?$/.test(valor) || valor.length >= 3;

  const mostrarError = (input, errorEl, mensaje) => {
    const group = input.closest('.input-group');
    if (group) group.classList.add('has-error');
    if (errorEl) errorEl.textContent = mensaje;
  };

  const limpiarError = (input, errorEl) => {
    const group = input.closest('.input-group');
    if (group) group.classList.remove('has-error');
    if (errorEl) errorEl.textContent = '';
  };

  const mostrarAlerta = (mensaje, tipo) => {
    if (!alertBox) return;
    alertBox.textContent = mensaje;
    alertBox.className = 'alert show ' + tipo;
  };

  // ============================================================
  // 🔹 CONFIGURACIÓN DE LA API
  // ============================================================
  const API_CONFIG = {
    // El login pasa por el backend (proxy hacia Odoo) → mismo origen, sin CORS.
    // En dev Astro lo redirige a :8000 (proxy /api); en producción lo hace nginx.
    LOGIN_URL: '/api/auth/login',
    REDIRECT_URL: '/hub',              // ← ruta por defecto
    TOKEN_KEY: 'auth_token',
    USER_KEY: 'auth_user',
    ROLE_KEY: 'auth_role',             // rol principal (key de geoportal_roles[0])
    ROLES_FULL_KEY: 'auth_roles_full', // array completo de geoportal_roles
    WORKSPACES_KEY: 'auth_workspaces', // array de NOMBRES de workspaces
    EXPIRES_KEY: 'auth_expires_at',
  };

  // 🔀 Rutas por rol (ajusta a tus rutas reales)
  const ROUTES_BY_ROLE = {
    'Rol_Analista': '/hub',
    // 'Rol_Admin': '/hub',
    // 'Rol_Visor': '/geoportal',
    'Rol_Gerente': '/admin',
  };

  // ---- 6. Submit ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let esValido = true;

    // Validar login (acepta "ligia@bsd" sin TLD)
    if (!emailInput.value.trim()) {
      mostrarError(emailInput, emailError, 'El usuario es obligatorio');
      esValido = false;
    } else if (!validarLogin(emailInput.value.trim())) {
      mostrarError(emailInput, emailError, 'Ingresa un usuario válido');
      esValido = false;
    } else {
      limpiarError(emailInput, emailError);
    }

    // Validar contraseña
    if (!passwordInput.value) {
      mostrarError(passwordInput, passwordError, 'La contraseña es obligatoria');
      esValido = false;
    } else if (passwordInput.value.length < 6) {
      mostrarError(passwordInput, passwordError, 'Debe tener al menos 6 caracteres');
      esValido = false;
    } else {
      limpiarError(passwordInput, passwordError);
    }

    if (!esValido) return;

    btnLogin.disabled = true;
    if (spinner) spinner.classList.add('active');
    if (alertBox) alertBox.className = 'alert';

    try {
      const response = await fetch(API_CONFIG.LOGIN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          login: emailInput.value.trim(), // ⚠️ la API usa "login"
          password: passwordInput.value,
        }),
      });

      // Manejo robusto (por si la API devuelve texto plano en errores)
      const contentType = response.headers.get('content-type') || '';
      let data = null;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        await response.text().catch(() => '');
        data = {
          detail:
            response.status >= 500
              ? `El servidor no está disponible (HTTP ${response.status}). Intenta de nuevo en unos minutos.`
              : `Error HTTP ${response.status}`,
        };
      }

      if (response.ok && data?.access_token) {
        // ============================================================
        // 🔹 Extraer ROL PRINCIPAL desde geoportal_roles[0].key
        // ============================================================
        const geoportalRole = Array.isArray(data.geoportal_roles)
          ? data.geoportal_roles[0]
          : null;

        const roleKey = geoportalRole?.key || null;   // ej: "Rol_Analista"
        // (roleName y roleDept quedan disponibles en auth_roles_full)

        // ============================================================
        // 🔹 Extraer NOMBRES de workspaces
        // ============================================================
        const workspaceNames = Array.isArray(data.workspaces)
          ? data.workspaces.map((ws) => ws.name).filter(Boolean) // ["Petróleo","Showroom","Territorio"]
          : [];

        // ---- Guardar sesión ----
        localStorage.setItem(API_CONFIG.TOKEN_KEY, data.access_token);
        localStorage.setItem(API_CONFIG.USER_KEY, JSON.stringify(data.user || {}));

        if (roleKey) {
          localStorage.setItem(API_CONFIG.ROLE_KEY, roleKey);
        }
        localStorage.setItem(
          API_CONFIG.ROLES_FULL_KEY,
          JSON.stringify(data.geoportal_roles || [])
        );
        localStorage.setItem(
          API_CONFIG.WORKSPACES_KEY,
          JSON.stringify(workspaceNames)
        );

        if (data.expires_in) {
          const expiresAt = Date.now() + data.expires_in * 1000;
          localStorage.setItem(API_CONFIG.EXPIRES_KEY, String(expiresAt));
        }

        mostrarAlerta(
          `Bienvenida, ${data.user?.first_name || data.user?.name || 'usuario'}. Redirigiendo...`,
          'success'
        );

        setTimeout(() => {
          window.location.href =
            ROUTES_BY_ROLE[roleKey] || API_CONFIG.REDIRECT_URL;
        }, 1200);

      } else {
        const msg =
          data?.detail ||
          data?.message ||
          data?.error ||
          'Usuario o contraseña incorrectos';

        mostrarAlerta(msg, 'error');
      }

    } catch (err) {
      console.error('[Login error]', err);
      mostrarAlerta('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.', 'error');
    } finally {
      btnLogin.disabled = false;
      if (spinner) spinner.classList.remove('active');
    }
  });
});

// ============================================================
// 🔐 Auth · Helpers de sesión (úsalos en cualquier página)
// ============================================================
const Auth = {
  getToken: () => localStorage.getItem('auth_token'),

  getUser: () => JSON.parse(localStorage.getItem('auth_user') || 'null'),

  // Rol principal (key) — ej: "Rol_Analista"
  getRole: () => localStorage.getItem('auth_role'),

  // Todos los roles geoportal con name + department
  getRolesFull: () => JSON.parse(localStorage.getItem('auth_roles_full') || '[]'),

  // Nombres de workspaces — ej: ["Petróleo","Showroom","Territorio"]
  getWorkspaces: () => JSON.parse(localStorage.getItem('auth_workspaces') || '[]'),

  isLoggedIn() {
    const token = this.getToken();
    const expiresAt = Number(localStorage.getItem('auth_expires_at') || 0);
    if (!token) return false;
    if (expiresAt && Date.now() >= expiresAt) {
      this.logout();
      return false;
    }
    return true;
  },

  hasRole(roleKey) {
    return this.getRole() === roleKey;
  },

  hasWorkspace(name) {
    return this.getWorkspaces().includes(name);
  },

  requireAuth() {
    if (!this.isLoggedIn()) window.location.href = '/login';
  },

  logout() {
    [
      'auth_token',
      'auth_user',
      'auth_role',
      'auth_roles_full',
      'auth_workspaces',
      'auth_expires_at',
      'userEmail',
      'userLogin',
      'user',
    ].forEach((k) => localStorage.removeItem(k));
    window.location.href = '/login';
  },
};

// Header Authorization para futuras peticiones protegidas
const authHeaders = (extra = {}) => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${Auth.getToken()}`,
  ...extra,
});