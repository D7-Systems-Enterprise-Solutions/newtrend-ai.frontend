import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { traceUserAction } from '@ai-newtrend/angular';

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
    traceUserAction(
      'Click "Save"',
      () => firstValueFrom(this.http.post('http://127.0.0.1:5088/providers', { name: 'Acme' })),
      {
        functionName: 'save',
        filePath: 'src/app/app.component.ts',
        line: 16,
      },
    )
      .then(() => this.result.set('Saved'))
      .catch(() => this.result.set('Could not save'));
  }
}
