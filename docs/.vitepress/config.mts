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
            { text: 'Auth', link: '/api/auth' },
            { text: 'Intake', link: '/api/intake' },
            { text: 'Notifications', link: '/api/notifications' },
            { text: 'SSE', link: '/api/sse' },
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
