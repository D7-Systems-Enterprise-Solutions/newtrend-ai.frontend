import { initAINewtrend } from '@ai-newtrend/angular';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

initAINewtrend({
  appName: 'Sample.Web',
  endpoint: 'http://127.0.0.1:4318',
});

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
