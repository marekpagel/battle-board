import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import manifest from './public/manifest.json'

/** Serve a labeled manifest in development, keeping the production manifest as the source. */
function devManifest(): Plugin {
  return {
    name: 'battle-board-dev-manifest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/manifest.json', (_req, res) => {
        const title = `${manifest.name} (Dev)`
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        // This middleware precedes Vite's built-in CORS handling.
        res.setHeader('Access-Control-Allow-Origin', 'https://www.owlbear.rodeo')
        res.end(JSON.stringify({
          ...manifest,
          name: title,
          version: `${manifest.version}-dev`,
          description: 'Local development build of Battle Board.',
          action: { ...manifest.action, title },
        }))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devManifest()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        elevation: 'elevation.html',
        groupmodal: 'groupmodal.html',
        turnbar: 'turnbar.html',
      }
    }
  },
  server: {
    cors: {
      origin: "https://www.owlbear.rodeo",
    },
  },
})
