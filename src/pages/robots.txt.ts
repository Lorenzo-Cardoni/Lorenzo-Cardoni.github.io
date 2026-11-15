import profile from '../data/profile.json';

export async function GET() {
  const siteUrl = profile.seo.siteUrl.replace(/\/$/, '');

  const body = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap-index.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
