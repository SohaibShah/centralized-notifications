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
      { text: 'Architecture', link: '/architecture/' },
    ],
    sidebar: {
      '/api/': [
        {
          text: 'API',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Admin', link: '/api/admin' },
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
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'BE library integration', link: '/architecture/be-library-integration' },
            { text: 'Library conversion direction', link: '/architecture/library-conversion-direction' },
          ],
        },
      ],
    },
  },
})
