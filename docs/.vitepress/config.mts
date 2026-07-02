import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Project Docs',
  description: 'API reference, frontend notes, and architecture docs.',
  srcDir: '.',
  themeConfig: {
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'API', link: '/api/' },
      { text: 'Frontend', link: '/frontend/' },
    ],
    sidebar: {
      '/api/': [
        {
          text: 'API',
          items: [
            { text: 'Overview', link: '/api/' },
            // docs-writer adds an entry here per resource, e.g.:
            // { text: 'Expenses', link: '/api/expenses' },
          ],
        },
      ],
      '/frontend/': [
        {
          text: 'Frontend',
          items: [
            { text: 'Overview', link: '/frontend/' },
          ],
        },
      ],
    },
  },
})
