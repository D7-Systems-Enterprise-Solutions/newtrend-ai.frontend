import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  readonly result = signal('Ready');

  save(): void {
    this.result.set('Saving');
    firstValueFrom(this.http.post('http://127.0.0.1:5088/providers', { name: 'Acme' }))
      .then(() => this.result.set('Saved'))
      .catch(() => this.result.set('Could not save'));
  }
}
