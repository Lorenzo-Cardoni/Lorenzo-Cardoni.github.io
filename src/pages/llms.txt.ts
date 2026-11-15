import type { APIRoute } from 'astro';
import profile from '../data/profile.json';
import experience from '../data/experience.json';
import projects from '../data/projects.json';
import skills from '../data/skills.json';
import background from '../data/background.json';

// Plain-text summary of the site for LLM crawlers, generated from the same data as the page.
export const GET: APIRoute = async () => {
  const siteUrl = profile.seo.siteUrl.replace(/\/$/, '');

  const experienceStr = experience
    .map((job) => `- **${job.role}**, ${job.company} (${job.period})\n${job.highlights.map((h) => `  - ${h}`).join('\n')}`)
    .join('\n');

  const allProjects = [...projects.featured, ...projects.more];
  const projectsStr = allProjects
    .map((p) => `- **${p.title}:** ${p.description}${p.link ? ` (${p.link})` : ''}`)
    .join('\n');

  const publicationsStr = background.publications
    .map((p) => `- ${p.authors.join(', ')}. "${p.title}". ${p.venue}, ${p.date}. https://doi.org/${p.doi}`)
    .join('\n');

  const educationStr = background.education
    .map((e) => `- **${e.degree}**, ${e.school} (${e.period}), ${e.grade}. Thesis: ${e.thesis}.`)
    .join('\n');

  const skillsStr = skills.map((g) => `- **${g.title}:** ${g.skills.join(', ')}`).join('\n');

  const linksStr = profile.socials.map((s) => `- **${s.name}:** ${s.url}`).join('\n');

  const markdown = `# ${profile.name}

> ${profile.seo.description}

## Overview
${profile.name} is an ${profile.jobTitle} based in ${profile.location}. Currently: ${profile.status[0].value}. Focus: ${profile.status[1].value}.

## Experience
${experienceStr}

## Projects
${projectsStr}

## Publications
${publicationsStr}

## Education
${educationStr}

## Skills
${skillsStr}

## Contact and links
- **Website:** ${siteUrl}
- **Email:** ${profile.email}
${linksStr}
`;

  return new Response(markdown.trim() + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
