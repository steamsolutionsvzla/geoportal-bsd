import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  loginForm: FormGroup;
  loading = false;
  showPassword = false;
  alertMsg = '';
  alertType: 'success' | 'error' | '' = '';

  constructor(private fb: FormBuilder) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      remember: [false]
    });
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  get email() {
    return this.loginForm.get('email');
  }

  get password() {
    return this.loginForm.get('password');
  }

  onSubmit(): void {
    this.alertMsg = '';
    this.loginForm.markAllAsTouched();

    if (this.loginForm.invalid) return;

    this.loading = true;
    const { email, password } = this.loginForm.value;

    // Reemplaza esto por tu servicio real de autenticación, ej:
    // this.authService.login(email, password).subscribe(...)
    setTimeout(() => {
      if (email === 'admin@empresa.com' && password === '123456') {
        this.alertType = 'success';
        this.alertMsg = 'Inicio de sesión exitoso. Redirigiendo...';
        // this.router.navigate(['/dashboard']);
      } else {
        this.alertType = 'error';
        this.alertMsg = 'Correo o contraseña incorrectos';
      }
      this.loading = false;
    }, 1200);
  }
}
