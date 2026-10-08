# Newtrend-ai for an Angular app

Add this SDK to any Angular frontend so each user action is one trace. HTTP calls made inside that action carry the same trace to your ASP.NET Core API.

The SDK does not show the live view. Traces go to the Newtrend-ai core, and the dashboard reads them. Start the core from the backend repository before you use the app. See that repository's README for `dotnet run` and the dashboard.

| Piece       | Address                   |
| ----------- | ------------------------- |
| Core ingest | `http://127.0.0.1:4318` |
| Dashboard   | `http://127.0.0.1:4317` |

## 1. Build the SDK

The package is not on npm yet. From this repository:

```bash
cd sdk/angular
npm install
npm run build
```

## 2. Depend on it from your app

In your Angular app's `package.json`:

```json
"@newtrend-ai/angular": "file:C:/Sources/newtrend-ai/newtrend-ai.FrontEnd/sdk/angular"
```

Use the real path on your machine. Then install:

```bash
npm install
```

`zone.js` 0.14 or newer must already be in the app. Angular apps have it.

## 3. Start it once, before bootstrap

In `src/main.ts`, call `initAINewtrend` before `bootstrapApplication`. That starts click and submit capture, and it instruments `XMLHttpRequest` and `fetch`, which is what Angular's `HttpClient` uses. `zone.js` must already be loaded. Angular does that before `main.ts`.

```ts
import { initAINewtrend } from '@newtrend-ai/angular';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app.component';

initAINewtrend({
  appName: 'MyApp',
  endpoint: 'http://127.0.0.1:4318',
});

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
```

`appName` is the service name on frontend spans. `endpoint` is the core. `/v1/traces` is appended when you omit it.

Optional `propagateTo` limits which URLs receive the `traceparent` header. The default is every URL.

```ts
initAINewtrend({
  appName: 'MyApp',
  endpoint: 'http://127.0.0.1:4318',
  propagateTo: /^http:\/\/127\.0\.0\.1:5088/,
});
```

## 4. Leave the button handlers alone

A click on a `button`, link, or `[role="button"]`, and a form `submit`, become a frontend step on their own. The label is the control's `aria-label`, then its visible text. An HTTP call started from that handler stays on the same trace. You do not add code to each method.

Clicks that are not on those controls are ignored. Typing is ignored.

`traceUserAction` is only for work that does not come from a click or submit, such as a timer or a keyboard shortcut. HTTP calls inside its callback stay on that action. The third argument is optional source location.

```ts
import { traceUserAction } from '@newtrend-ai/angular';

loadOnShortcut(): void {
  traceUserAction('Shortcut "Refresh"', () => this.http.get('/providers'), {
    functionName: 'loadOnShortcut',
    filePath: 'src/app/providers.component.ts',
    line: 12,
  });
}
```

## What one action produces

One Save click produces one execution: a frontend step for the click, an HTTP step for the request, and a backend step once the .NET SDK is registered on the API. Open `http://127.0.0.1:4317` and use the app. The execution appears without restarting the dashboard.

Simple lists each step. Execution lists the same steps and, under each one, the file and method. The frontend file comes from the dev server source map. The backend file comes from the API's debug symbols. Run the API as a Debug build so the PDB sits next to the assembly.
