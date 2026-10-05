import { defineConfig } from 'vitest/config'

// Configuration séparée de vite.config.ts : les tests n'ont besoin ni du PWA ni du serveur d'API.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    // Avec un Redis de test (proxy SRH), fichiers l'un après l'autre : sous charge parallèle, SRH mélange
    // les transactions MULTI/EXEC de connexions différentes (ce que ne fait pas Upstash).
    fileParallelism: !process.env.SILLAGE_TEST_REDIS_URL,
  },
})
