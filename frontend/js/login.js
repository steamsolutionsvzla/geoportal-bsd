document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const togglePassword = document.getElementById('togglePassword');
  const btnLogin = document.getElementById('btnLogin');
  const spinner = document.getElementById('spinner');
  const alertBox = document.getElementById('alertBox');

  // Mostrar / ocultar contraseña
  togglePassword.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePassword.textContent = isPassword ? '🙈' : '👁';
  });

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

    // Simular llamada a API de autenticación
    btnLogin.disabled = true;
    spinner.classList.add('active');
    alertBox.className = 'alert';

    try {
      const respuesta = await simularLogin(emailInput.value.trim(), passwordInput.value);

      if (respuesta.ok) {
        mostrarAlerta('Inicio de sesión exitoso. Redirigiendo...', 'success');
        // Aquí rediriges a tu panel real, ej:
        // window.location.href = '/dashboard.html';
      } else {
        mostrarAlerta(respuesta.mensaje, 'error');
      }
    } catch (err) {
      mostrarAlerta('Error de conexión. Intenta de nuevo.', 'error');
    } finally {
      btnLogin.disabled = false;
      spinner.classList.remove('active');
    }
  });

  // Simula una petición a un backend real (reemplaza con fetch() a tu API)
  function simularLogin(email, password) {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Ejemplo de credenciales de prueba
        if (email === 'admin@empresa.com' && password === '123456') {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, mensaje: 'Correo o contraseña incorrectos' });
        }
      }, 1200);
    });
  }
});
