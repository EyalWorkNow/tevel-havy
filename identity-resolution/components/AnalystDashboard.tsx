import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  FileWarning,
  GitCompareArrows,
  Layers3,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  CanonicalPersonProfile,
  ConflictQueueItem,
  PersonMentionRecord,
  ResolutionMetric,
} from '../types';

interface Props {
  metrics: ResolutionMetric[];
  mentions: PersonMentionRecord[];
  profiles: CanonicalPersonProfile[];
  queue: ConflictQueueItem[];
  onOpenMention: (mentionId: string) => void;
  onOpenProfile: (profileId: string) => void;
  onOpenQueueItem: (item: ConflictQueueItem) => void;
}

export function AnalystDashboard({
  metrics,
  mentions,
  profiles,
  queue,
  onOpenMention,
  onOpenProfile,
  onOpenQueueItem,
}: Props) {
  const lowConfidenceMentions = useMemo(
    () => mentions.filter((mention) => mention.confidence < 0.6 || mention.status !== 'resolved'),
    [mentions],
  );
  const duplicateRiskProfiles = useMemo(
    () => profiles.filter((profile) => profile.unresolvedAliases.length > 0 || profile.contradictions.length > 0),
    [profiles],
  );
  const crossDocumentProfiles = useMemo(
    () => profiles.filter((profile) => profile.linkedDocuments.length > 1),
    [profiles],
  );

  return (
    <div className="id-screen">
      <header className="id-screen-header">
        <div>
          <div className="id-screen-kicker">Analyst dashboard</div>
          <h1 className="id-screen-title">Review pressure, duplicate risk, and evidence-backed merge safety.</h1>
          <p className="id-screen-subtitle">
            This dashboard prioritizes uncertainty first. Conflicts stay visible, duplicates stay reviewable, and every
            summary points back to evidence.
          </p>
        </div>
        <div className="id-callout">
          <ShieldCheck size={18} />
          <div>
            <strong>Resolution policy</strong>
            <span>No silent merges. No dossier fields without evidence.</span>
          </div>
        </div>
      </header>

      <section className="id-metric-grid">
        {metrics.map((metric) => (
          <article key={metric.label} className={`id-metric-card ${metric.tone ?? 'primary'}`}>
            <div className="id-metric-label">{metric.label}</div>
            <div className="id-metric-value">{metric.value}</div>
            <div className="id-metric-detail">{metric.detail}</div>
          </article>
        ))}
      </section>

      <section className="id-dashboard-grid">
        <article className="id-surface-card">
          <div className="id-card-header">
            <div>
              <div className="id-card-kicker">Low-confidence queue</div>
              <h2 className="id-card-title">Mentions that still need an analyst.</h2>
            </div>
            <FileWarning size={18} />
          </div>
          <div className="id-list">
            {lowConfidenceMentions.map((mention) => (
              <button key={mention.id} type="button" className="id-list-row" onClick={() => onOpenMention(mention.id)}>
                <div>
                  <div className="id-list-title">{mention.rawMention}</div>
                  <div className="id-list-detail">
                    {mention.documentTitle} • {mention.language} • {Math.round(mention.confidence * 100)}%
                  </div>
                  <div className="id-list-snippet">{mention.sourceSnippet}</div>
                </div>
                <span className={`id-status-chip ${mention.status}`}>{mention.status}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="id-surface-card">
          <div className="id-card-header">
            <div>
              <div className="id-card-kicker">Duplicate profile watch</div>
              <h2 className="id-card-title">Canonical people that still have unresolved identity paths.</h2>
            </div>
            <GitCompareArrows size={18} />
          </div>
          <div className="id-list">
            {duplicateRiskProfiles.map((profile) => (
              <button key={profile.id} type="button" className="id-list-row" onClick={() => onOpenProfile(profile.id)}>
                <div>
                  <div className="id-list-title">{profile.canonicalName}</div>
                  <div className="id-list-detail">
                    {profile.aliases.length} aliases • {profile.linkedDocuments.length} linked documents •{' '}
                    {Math.round(profile.confidenceSummary * 100)}% confidence
                  </div>
                  <div className="id-token-row">
                    {profile.unresolvedAliases.slice(0, 3).map((alias) => (
                      <span key={alias} className="id-token">
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="id-dashboard-grid">
        <article className="id-surface-card">
          <div className="id-card-header">
            <div>
              <div className="id-card-kicker">Conflict / unresolved queue</div>
              <h2 className="id-card-title">Items where ambiguity is still operationally relevant.</h2>
            </div>
            <AlertTriangle size={18} />
          </div>
          <div className="id-list">
            {queue.map((item) => (
              <button key={item.mentionId} type="button" className="id-list-row" onClick={() => onOpenQueueItem(item)}>
                <div>
                  <div className="id-list-title">{item.canonicalHint ?? item.mentionId}</div>
                  <div className="id-list-detail">{item.reason}</div>
                </div>
                <span className={`id-severity ${item.severity}`}>{item.severity}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="id-surface-card">
          <div className="id-card-header">
            <div>
              <div className="id-card-kicker">Cross-document identity memory</div>
              <h2 className="id-card-title">People already traced across multiple files.</h2>
            </div>
            <Layers3 size={18} />
          </div>
          <div className="id-list">
            {crossDocumentProfiles.map((profile) => (
              <button key={profile.id} type="button" className="id-list-row" onClick={() => onOpenProfile(profile.id)}>
                <div>
                  <div className="id-list-title">{profile.canonicalName}</div>
                  <div className="id-list-detail">
                    {profile.linkedDocuments.map((doc) => doc.title).join(' • ')}
                  </div>
                </div>
                <span className="id-pill-inline">
                  <Users size={12} />
                  {profile.linkedDocuments.length} docs
                </span>
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
