import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface AppCard {
  route: string;
  icon: string;
  title: string;
  description: string;
  color: string;
}

@Component({
  selector: 'app-hub-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './hub-page.component.html',
  styleUrl: './hub-page.component.scss',
})
export class HubPageComponent {
  cards: AppCard[] = [
    {
      route: '/backtrack',
      icon: '🔍',
      title: 'Backtrack Scanner',
      description: 'Scan your SMB drive for recent Backtrack recordings, copy them locally, and clean up clustered duplicates.',
      color: '#a855f7',
    },
    {
      route: '/shorts-editor',
      icon: '💬',
      title: 'shorts-auto-editor',
      description: 'Queue gaming clips, add comic-book onomatopoeia overlays, transcribe mic & desktop audio, and generate AI-powered titles — all without opening the GUI.',
      color: '#34d399',
    },
    {
      route: '/publisher',
      icon: '▶',
      title: 'YouTube Shorts Publisher',
      description: 'Configure the run mode (AI Analysis, Scraper, or Publish), adjust settings, and launch the Playwright browser automation that schedules your draft Shorts.',
      color: '#f87171',
    },
    {
      route: '/shorts-analyzer',
      icon: '📊',
      title: 'Shorts Analyzer',
      description: 'Pull a channel\'s top Shorts, score Analytics retention, run Gemini per-video analysis, and generate corpus-level synthesis + tailwind hypotheses.',
      color: '#38bdf8',
    },
    {
      route: '/strategist',
      icon: '🧠',
      title: 'Shorts Strategist',
      description: 'Deep-think reasoning service: multi-pass title generation, cut planning, special effects, plus strategy-memory linking edits to outcomes and an experiment designer.',
      color: '#fb923c',
    },
  ];
}