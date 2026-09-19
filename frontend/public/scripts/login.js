// ============================================================
// Login · Geoportal BSD
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // ---- 1. Si ya hay sesión, redirigir al geoportal ----
  // Descomenta esto SOLO en producción.
  // if (localStorage.getItem('auth_session')) {
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

  // ---- 5. Helpers ----
  const validarEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

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

  // ---- 6. Submit ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let esValido = true;

    // Validar email
    if (!emailInput.value.trim()) {
      mostrarError(emailInput, emailError, 'El correo es obligatorio');
      esValido = false;
    } else if (!validarEmail(emailInput.value.trim())) {
      mostrarError(emailInput, emailError, 'Ingresa un correo válido');
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

    // ============================================================
    // 🔹 MODO SIMULACIÓN (sin backend)
    // Cambia a false cuando tengas backend real
    // ============================================================
    const MODO_SIMULACION = true;

    if (MODO_SIMULACION) {
      setTimeout(() => {
        localStorage.setItem('auth_session', 'activo');
        localStorage.setItem('userEmail', emailInput.value.trim());

        mostrarAlerta('Inicio de sesión exitoso. Redirigiendo...', 'success');

        setTimeout(() => {
          window.location.href = '/geoportal';
        }, 1200);

        btnLogin.disabled = false;
        if (spinner) spinner.classList.remove('active');
      }, 900);
      return;
    }
    // ============================================================
    // 🔹 FIN SIMULACIÓN
    // ============================================================

    // ---- Petición real al backend ----
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('auth_session', 'activo');
        localStorage.setItem('userEmail', emailInput.value.trim());

        mostrarAlerta('Inicio de sesión exitoso. Redirigiendo...', 'success');

        setTimeout(() => {
          window.location.href = '/geoportal';
        }, 1500);
      } else {
        mostrarAlerta(data.detail || 'Correo o contraseña incorrectos', 'error');
      }
    } catch (err) {
      console.error(err);
      mostrarAlerta('Error de conexión con el servidor. Intenta de nuevo.', 'error');
    } finally {
      btnLogin.disabled = false;
      if (spinner) spinner.classList.remove('active');
    }
  });
});