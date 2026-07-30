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

    // Activar estado de carga y bloquear botón
    btnLogin.disabled = true;
    spinner.classList.add('active');
    alertBox.className = 'alert';

    try {
      // Petición real hacia el endpoint de FastAPI
     // const response = await fetch('http://localhost:8000/api/login',
      const response = await fetch('http://localhost:8000/api/login',
         {
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
        // 🔒 Guardamos la señal de sesión antes de redirigir
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userEmail', emailInput.value.trim());

        mostrarAlerta('Inicio de sesión exitoso. Redirigiendo...', 'success');

        // Redirigir al geoportal después de 1.5 segundos[cite: 2]
        setTimeout(() => {
          window.location.href = './geoportal.html'; 
        }, 1500);

      } else {
        // Manejo de error devuelto por FastAPI
        const mensajeError = data.detail || 'Correo o contraseña incorrectos';
        mostrarAlerta(mensajeError, 'error');
      }

    } catch (err) {
      console.error(err);
      mostrarAlerta('Error de conexión con el servidor. Intenta de nuevo.', 'error');
    } finally {
      // Restaurar estado del botón y ocultar spinner
      btnLogin.disabled = false;
      spinner.classList.remove('active');
    }
  });
});