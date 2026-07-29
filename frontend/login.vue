<template>
  <div class="login-wrapper">
    <div class="login-card">
      <div class="login-logo">
        <div class="logo-circle">EC</div>
        <h1>Empresa Corp</h1>
        <p>Accede a tu panel de trabajo</p>
      </div>

      <form @submit.prevent="handleSubmit" novalidate>
        <div class="input-group" :class="{ 'has-error': errors.email }">
          <label for="email">Correo corporativo</label>
          <input id="email" v-model="email" type="email" placeholder="nombre@empresa.com" />
          <span class="error-msg">{{ errors.email }}</span>
        </div>

        <div class="input-group" :class="{ 'has-error': errors.password }">
          <label for="password">Contraseña</label>
          <div class="password-field">
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="••••••••"
            />
            <button type="button" class="toggle-password" @click="showPassword = !showPassword">
              {{ showPassword ? '🙈' : '👁' }}
            </button>
          </div>
          <span class="error-msg">{{ errors.password }}</span>
        </div>

        <div class="options-row">
          <label class="checkbox-label">
            <input type="checkbox" v-model="remember" />
            <span>Recordarme</span>
          </label>
          <a href="#" class="forgot-link">¿Olvidaste tu contraseña?</a>
        </div>

        <button type="submit" class="btn-login" :disabled="loading">
          <span>{{ loading ? 'Verificando...' : 'Iniciar sesión' }}</span>
        </button>

        <div v-if="alertMsg" class="alert show" :class="alertType">{{ alertMsg }}</div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const email = ref('')
const password = ref('')
const remember = ref(false)
const showPassword = ref(false)
const loading = ref(false)
const errors = ref({ email: '', password: '' })
const alertMsg = ref('')
const alertType = ref('')

function validarEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function handleSubmit() {
  errors.value = { email: '', password: '' }
  alertMsg.value = ''

  let valido = true

  if (!email.value.trim()) {
    errors.value.email = 'El correo es obligatorio'
    valido = false
  } else if (!validarEmail(email.value.trim())) {
    errors.value.email = 'Ingresa un correo válido'
    valido = false
  }

  if (!password.value) {
    errors.value.password = 'La contraseña es obligatoria'
    valido = false
  } else if (password.value.length < 6) {
    errors.value.password = 'Debe tener al menos 6 caracteres'
    valido = false
  }

  if (!valido) return

  loading.value = true
  try {
    // Reemplaza esto por tu endpoint real, por ejemplo:
    // const { data } = await useFetch('/api/login', { method: 'POST', body: { email: email.value, password: password.value } })
    await new Promise((resolve) => setTimeout(resolve, 1200))

    if (email.value === 'admin@empresa.com' && password.value === '123456') {
      alertType.value = 'success'
      alertMsg.value = 'Inicio de sesión exitoso. Redirigiendo...'
      // navigateTo('/dashboard')
    } else {
      alertType.value = 'error'
      alertMsg.value = 'Correo o contraseña incorrectos'
    }
  } catch (e) {
    alertType.value = 'error'
    alertMsg.value = 'Error de conexión. Intenta de nuevo.'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
/* Puedes pegar aquí el mismo CSS de style.css de la versión vanilla,
   ajustando selectores si hace falta (las clases son iguales). */
.login-wrapper {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #10263d, #1a3b5d 60%, #2f80ed);
  padding: 20px;
}
.login-card {
  background: #fff;
  border-radius: 14px;
  padding: 40px 36px;
  max-width: 420px;
  width: 100%;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.25);
}
</style>
