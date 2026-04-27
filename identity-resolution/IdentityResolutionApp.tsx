import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileSearch,
  LayoutDashboard,
  Search,
  ShieldAlert,
  UserRoundSearch,
  Users,
} from 'lucide-react';
import { StudyItem } from '../types';
import { ConflictQueueItem } from './types';
import { buildIdentityResolutionDataset } from './liveData';
import './styles.css';
import { AnalystDashboard } from './components/AnalystDashboard';
import { DocumentReview } from './components/DocumentReview';
import { ProfileView } from './components/ProfileView';
import { ResolutionQueue } from './components/ResolutionQueue';

type Screen = 'dashboard' | 'review' | 'queue' | 'profiles';

interface Props {
  studies?: StudyItem[];
}

export default function IdentityResolutionApp({ studies = [] }: Props) {
  const dataset = useMemo(() => buildIdentityResolutionDataset(studies), [studies]);
  const { metrics, mentions, profiles, queue, snippets, dataSource, backendStudies, fallbackStudies, warnings } = dataset;
  const [activeScreen, setActiveScreen] = useState<Screen>('dashboard');
  const [selectedMentionId, setSelectedMentionId] = useState<string>(mentions[0]?.id ?? '');
  const [selectedProfileId, setSelectedProfileId] = useState<string>(profiles[0]?.id ?? '');
  const [queueFilter, setQueueFilter] = useState<'all' | 'conflict' | 'uncertain' | 'unresolved'>('all');

  const selectedMention = useMemo(
    () => mentions.find((mention) => mention.id === selectedMentionId) ?? mentions[0],
    [mentions, selectedMentionId],
  );

  const selectedProfile = useMemo(() => {
    const fromMention = selectedMention?.suggestedIdentityId
      ? profiles.find((profile) => profile.id === selectedMention.suggestedIdentityId)
      : undefined;
    return (
      profiles.find((profile) => profile.id === selectedProfileId) ??
      fromMention ??
      profiles[0]
    );
  }, [profiles, selectedMention, selectedProfileId]);

  const lowConfidenceMentions = useMemo(
    () => mentions.filter((mention) => mention.confidence < 0.6 || mention.status !== 'resolved'),
    [mentions],
  );

  const duplicateRiskProfiles = useMemo(
    () => profiles.filter((profile) => profile.unresolvedAliases.length > 0 || profile.contradictions.length > 0),
    [profiles],
  );

  const handleSelectMention = (mentionId: string) => {
    const mention = mentions.find((item) => item.id === mentionId);
    setSelectedMentionId(mentionId);
    if (mention?.suggestedIdentityId) {
      setSelectedProfileId(mention.suggestedIdentityId);
    }
  };

  const handleSelectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    setActiveScreen('profiles');
  };

  const handleSelectQueueItem = (item: ConflictQueueItem) => {
    setQueueFilter(item.reason.toLowerCase().includes('conflict') ? 'conflict' : queueFilter);
    handleSelectMention(item.mentionId);
    setActiveScreen('review');
  };

  const navItems: Array<{
    key: Screen;
    label: string;
    description: string;
    icon: React.ReactNode;
    count?: string;
  }> = [
    {
      key: 'dashboard',
      label: 'Analyst dashboard',
      description: 'Low-confidence load, duplicate pressure, and queue velocity.',
      icon: <LayoutDashboard size={18} />,
      count: metrics[1]?.value,
    },
    {
      key: 'review',
      label: 'Extraction review',
      description: 'Inspect raw mentions, evidence, and resolution proposals document by document.',
      icon: <FileSearch size={18} />,
      count: String(mentions.length),
    },
    {
      key: 'queue',
      label: 'Conflict queue',
      description: 'Resolve unresolved, uncertain, and conflicting person identities safely.',
      icon: <AlertTriangle size={18} />,
      count: String(queue.length),
    },
    {
      key: 'profiles',
      label: 'Canonical profiles',
      description: 'Review consolidated dossiers, evidence trails, and contradictions.',
      icon: <Users size={18} />,
      count: String(profiles.length),
    },
  ];

  const renderScreen = () => {
    switch (activeScreen) {
      case 'dashboard':
        return (
          <AnalystDashboard
            metrics={metrics}
            mentions={mentions}
            profiles={profiles}
            queue={queue}
            onOpenMention={handleSelectMention}
            onOpenProfile={handleSelectProfile}
            onOpenQueueItem={handleSelectQueueItem}
          />
        );
      case 'review':
        return (
          <DocumentReview
            mentions={mentions}
            snippets={snippets}
            profiles={profiles}
            selectedMentionId={selectedMention.id}
            onSelectMention={handleSelectMention}
            onOpenProfile={handleSelectProfile}
          />
        );
      case 'queue':
        return (
          <ResolutionQueue
            mentions={mentions}
            queueItems={queue}
            profiles={profiles}
            filter={queueFilter}
            onChangeFilter={setQueueFilter}
            onSelectMention={handleSelectMention}
            onOpenProfile={handleSelectProfile}
          />
        );
      case 'profiles':
        return (
          <ProfileView
            profile={selectedProfile}
            mentions={mentions}
            onOpenMention={handleSelectMention}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="id-app-shell">
      <aside className="id-rail">
        <div className="id-brand">
          <div className="id-brand-mark">
            <ShieldAlert size={18} />
          </div>
          <div>
            <div className="id-brand-kicker">Tevel Investigations</div>
            <div className="id-brand-title">Person Identity Resolution</div>
          </div>
        </div>

        <div className="id-rail-search">
          <Search size={14} />
          <span>Find a person, alias, org, or case node</span>
        </div>

        <nav className="id-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`id-nav-card ${activeScreen === item.key ? 'active' : ''}`}
              onClick={() => setActiveScreen(item.key)}
            >
              <div className="id-nav-card-row">
                <span className="id-nav-icon">{item.icon}</span>
                {item.count ? <span className="id-nav-count">{item.count}</span> : null}
              </div>
              <div className="id-nav-label">{item.label}</div>
              <div className="id-nav-description">{item.description}</div>
            </button>
          ))}
        </nav>

        <div className="id-rail-foot">
          <div className="id-system-pill">
            <UserRoundSearch size={14} />
            <span>{dataSource === 'live' ? 'Live evidence resolution' : 'Mock showcase mode'}</span>
          </div>
          <div className="id-foot-note">
            {dataSource === 'live'
              ? `${backendStudies} studies are backend-backed, ${fallbackStudies} studies remain fallback-derived.`
              : 'Never force merges. Low-confidence identities stay analyst-visible until corroborated.'}
          </div>
        </div>
      </aside>

      <main className="id-stage">{renderScreen()}</main>

      <aside className="id-global-panel">
        <div className="id-panel-section">
          <div className="id-panel-kicker">Active mention</div>
          <div className="id-panel-title">{selectedMention.rawMention}</div>
          <div className="id-panel-meta">
            <span>{selectedMention.documentTitle}</span>
            <span>Page {selectedMention.page ?? 'n/a'}</span>
            <span>{selectedMention.language}</span>
          </div>
          <div className={`id-status-chip ${selectedMention.status}`}>{selectedMention.status}</div>
          <p className="id-panel-snippet">"{selectedMention.sourceSnippet}"</p>
        </div>

        <div className="id-panel-section">
          <div className="id-panel-kicker">Suggested identity</div>
          <button type="button" className="id-inline-profile" onClick={() => handleSelectProfile(selectedProfile.id)}>
            <span>{selectedProfile.canonicalName}</span>
            <span className="id-inline-score">{Math.round(selectedProfile.confidenceSummary * 100)}%</span>
          </button>
          <div className="id-mini-list">
            <div>
              <strong>Aliases</strong>
              <span>{selectedProfile.aliases.slice(0, 3).join(' • ')}</span>
            </div>
            <div>
              <strong>Organizations</strong>
              <span>{selectedProfile.organizations.join(' • ')}</span>
            </div>
            <div>
              <strong>Duplicate risk</strong>
              <span>{selectedProfile.unresolvedAliases.length ? `${selectedProfile.unresolvedAliases.length} unresolved alias paths` : 'No open duplicate flags'}</span>
            </div>
          </div>
        </div>

        <div className="id-panel-section">
          <div className="id-panel-kicker">Shift focus</div>
          <div className="id-focus-grid">
            <div className="id-focus-card">
              <span className="id-focus-value">{lowConfidenceMentions.length}</span>
              <span className="id-focus-label">Mentions to review</span>
            </div>
            <div className="id-focus-card">
              <span className="id-focus-value">{duplicateRiskProfiles.length}</span>
              <span className="id-focus-label">Profiles with contradiction risk</span>
            </div>
          </div>
        </div>

        {warnings.length ? (
          <div className="id-panel-section">
            <div className="id-panel-kicker">Pipeline warnings</div>
            <div className="id-warning-stack compact">
              {warnings.slice(0, 3).map((warning) => (
                <div key={warning} className="id-warning-card subtle">
                  {warning}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
