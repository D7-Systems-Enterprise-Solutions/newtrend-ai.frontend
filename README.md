# Newtrend-ai frontend

Newtrend-ai is a modern web application designed to track, analyze, and visualize application behavior in real time. It helps you see exactly what is happening—from the frontend click all the way to the backend repository layer.

## With Newtrend-ai tool you'll get
- Full traceability from frontend to backend
- Source code file paths, so you know where to look
- Get the SQL statement along with its parameter values—ready to copy into your preferred client
- Get the cURL command along with its parameter values—ready to copy into your preferred client
- Get the parameter values immediately
- Export the trace in JSON format

## Some characteristics
Main window
![Newtrend AI Main Window](https://github.com/D7-Systems-Enterprise-Solutions/assets/raw/main/newtrend-ai/newtrend-ai-main-window.png)

SQL Query using the parameters values
![Newtrend AI Main Window](https://github.com/D7-Systems-Enterprise-Solutions/assets/blob/main/newtrend-ai/newtrend-ai-copy-feature-1.png)

This repository is the browser SDK and the dashboard. The SDK turns one user action into one trace and sends it to the Newtrend-ai core. The dashboard reads those traces. It does not collect them.

**This is for development time only.** Do not add this SDK to a production application, and do not deploy the dashboard or the collector as a production service. The collector has no authentication. A trace can contain clicks, HTTP metadata, request data, and SQL from the API. Masking on ingest is a safeguard, not a guarantee. Keep every process on loopback, on your own machine, and use synthetic data. If a build is going to production, leave `initNewtrendAi` out of it.

The packages are not on npm. You clone this repository, build the package you need, and point your app at that folder with a `file:` dependency. That link is for your development machine.

| You are adding it to | Clone | Package |
| --- | --- | --- |
| Angular | this repository | `@newtrend-ai/angular` |
| React | this repository | `@newtrend-ai/react` |
| ASP.NET Core | [newtrend-ai.backend](https://github.com/D7-Systems-Enterprise-Solutions/newtrend-ai.backend) | `NewtrendAi.Sdk` |
| Java (Spring Boot) | the `newtrend-ai.java` sources next to the backend | `newtrend-ai-spring-boot-starter` |

.NET and Java registration is in the backend repository README. The core must be running before the browser SDK has anywhere to send traces.

| Piece | Address |
| --- | --- |
| Core ingest | `http://127.0.0.1:4318` |
| Dashboard | `http://127.0.0.1:4317` |

## Download with git

```bash
git clone https://github.com/D7-Systems-Enterprise-Solutions/newtrend-ai.frontend.git
cd newtrend-ai.frontend
```

Use `main`. Build the SDK from that checkout. Do not copy the built `dist` folders into a production repository.

Start the core from the backend clone before you use an app:

```bash
git clone https://github.com/D7-Systems-Enterprise-Solutions/newtrend-ai.backend.git
cd newtrend-ai.backend
dotnet run --project src/NewtrendAi.Core
```

Leave that process running. Then, from this frontend clone:

```bash
cd apps/dashboard
npm install
npm run dev
```

Open `http://127.0.0.1:4317`.

## Add it to an Angular app

Development only. Call this from the app you run locally. Do not ship this registration in a production build.

From this clone, build the browser package first, then the Angular package:

```bash
cd sdk/browser
npm install
npm run build
cd ../angular
npm install
npm run build
```

In your Angular app's `package.json`, depend on the built package. Replace the path with the clone on your machine. Use forward slashes.

```json
"@newtrend-ai/angular": "file:C:/Sources/newtrend-ai.frontend/sdk/angular"
```

Then install:

```bash
npm install
```

`zone.js` 0.14 or newer must already be in the app. Angular apps have it.

In `src/main.ts`, call `initNewtrendAi` before `bootstrapApplication`, and only while Angular is in development mode. `isDevMode()` is false after a production build calls `enableProdMode()`, so the call is skipped there. That starts click and submit capture, and it instruments `XMLHttpRequest` and `fetch`, which is what Angular's `HttpClient` uses. `zone.js` must already be loaded. Angular does that before `main.ts`.

```ts
import { isDevMode } from '@angular/core';
import { initNewtrendAi } from '@newtrend-ai/angular';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app.component';

if (isDevMode()) {
  initNewtrendAi({
    appName: 'MyApp',
    endpoint: 'http://127.0.0.1:4318',
  });
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
```

`appName` is the service name on frontend spans. `endpoint` is the core. `/v1/traces` is appended when you omit it.

Optional `propagateTo` limits which URLs receive the `traceparent` header. The default is every URL. Point it at your local API.

```ts
if (isDevMode()) {
  initNewtrendAi({
    appName: 'MyApp',
    endpoint: 'http://127.0.0.1:4318',
    propagateTo: /^http:\/\/127\.0\.0\.1:5088/,
  });
}
```

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

`apps/sample/sample-web` is an Angular app wired this way.

## Add it to a React app

Development only. The React package uses the same browser tracer. `initNewtrendAi` loads `zone.js`, so the React app does not. Do not ship this registration in a production build.

Build the browser package first, then the React package:

```bash
cd sdk/browser
npm install
npm run build
cd ../react
npm install
npm run build
```

In the React app's `package.json`:

```json
"@newtrend-ai/react": "file:C:/Sources/newtrend-ai.frontend/sdk/react"
```

Use the real clone path, with forward slashes. Then `npm install`.

Call `initNewtrendAi` before `createRoot`, and only in a development build. With Vite, `import.meta.env.DEV` is true for `npm run dev` and false in the production bundle, so the call is left out of that bundle.

```jsx
import { initNewtrendAi } from '@newtrend-ai/react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

if (import.meta.env.DEV) {
  initNewtrendAi({
    appName: 'MyApp',
    endpoint: 'http://127.0.0.1:4318',
  });
}

createRoot(document.getElementById('root')).render(<App />);
```

A click on a button, link, or submit control becomes the frontend step. `fetch` and `XMLHttpRequest` made from that click stay on the same trace and send `traceparent` to the API. `traceUserAction` is the same helper as in the Angular package, for work that does not come from a click. `propagateTo` works the same way.

`apps/sample/sample-react` is a Vite app with one Save button. It posts to the .NET sample API on `http://127.0.0.1:5088`. The Java sample API listens on `http://127.0.0.1:5089`.

## What one action produces

One Save click produces one execution: a frontend step for the click, an HTTP step for the request, and a backend step once the .NET or Java SDK is registered on the API. Open `http://127.0.0.1:4317` and use the app. The execution appears without restarting the dashboard.

Simple lists each step. Execution lists the same steps and, under each one, the file and method. The frontend file comes from the dev server source map. The backend file comes from the API's debug symbols. Run the API as a Debug build so those symbols are available.

## Dashboard configuration

The dashboard defaults to `http://127.0.0.1:4318` for the collector. To override it, create `apps/dashboard/.env.local`:

```dotenv
VITE_NEW_TREND_API_URL=http://127.0.0.1:4318
```

Use the exact collector origin in the backend `Cors:AllowedOrigins` configuration when the dashboard is hosted on a different origin. Keep that origin on your development machine. Do not expose the collector.
