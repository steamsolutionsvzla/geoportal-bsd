document.addEventListener('DOMContentLoaded', () => {
  // ============================================================
  // 1. Si YA hay sesión, redirigir al geoportal
  // ============================================================
  if (localStorage.getItem('auth_session')) {
    window.location.href = './geoportal.html';
    return; // Detiene la ejecución
  }

  // ============================================================
  // 2. Referencias al DOM
  // ============================================================
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const togglePassword = document.getElementById('togglePassword');
  const btnLogin = document.getElementById('btnLogin');
  const spinner = document.getElementById('spinner');
  const alertBox = document.getElementById('alertBox');

  // ============================================================
  // 3. Mostrar / ocultar contraseña
  // ============================================================
  togglePassword.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePassword.textContent = isPassword ? '🙈' : '👁';
  });

  // ============================================================
  // 4. Validaciones
  // ============================================================
  function validarEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }

  function mostrarError(input, errorEl, mensaje) {
    input.closest('.input-group').classList.add('has-error');
    errorEl.textContent = mensaje;
  }

  function limpiarError(input, errorEl) {
    input.closest('.input-group').classList.remove('has-error');
    errorEl.textContent = '';
  }

  function mostrarAlerta(mensaje, tipo) {
    alertBox.textContent = mensaje;
    alertBox.className = `alert show ${tipo}`;
  }

  // ============================================================
  // 5. Envío del formulario
  // ============================================================
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

    // Activar carga
    btnLogin.disabled = true;
    spinner.classList.add('active');
    alertBox.className = 'alert';

    try {
      // 🔹 Si el backend NO tiene el endpoint /api/login, descomenta el bloque de abajo
      // y comenta el fetch para simular el login.
      /*
      // === SIMULACIÓN (para pruebas sin backend) ===
      if (emailInput.value.trim() && passwordInput.value.length >= 6) {
        localStorage.setItem('auth_session', 'activo');
        localStorage.setItem('userEmail', emailInput.value.trim());
        mostrarAlerta('Inicio de sesión exitoso (simulado). Redirigiendo...', 'success');
        setTimeout(() => {
          window.location.href = './geoportal.html';
        }, 1500);
      } else {
        mostrarAlerta('Credenciales inválidas', 'error');
      }
      btnLogin.disabled = false;
      spinner.classList.remove('active');
      return;
      // === FIN SIMULACIÓN ===
      */

      // 🔹 Petición real al backend
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value
        })
      });

      const data = await response.json();

      if (response.ok) {
        // Guardar sesión
        localStorage.setItem('auth_session', 'activo');
        localStorage.setItem('userEmail', emailInput.value.trim());

        mostrarAlerta('Inicio de sesión exitoso. Redirigiendo...', 'success');

        setTimeout(() => {
          window.location.href = './geoportal.html'; // ← Asegúrate que sea el nombre de tu geoportal
        }, 1500);

      } else {
        const mensajeError = data.detail || 'Correo o contraseña incorrectos';
        mostrarAlerta(mensajeError, 'error');
      }

    } catch (err) {
      console.error(err);
      mostrarAlerta('Error de conexión con el servidor. Intenta de nuevo.', 'error');
    } finally {
      btnLogin.disabled = false;
      spinner.classList.remove('active');
    }
  });
});