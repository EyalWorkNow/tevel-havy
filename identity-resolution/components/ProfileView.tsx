import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Building2,
  Clock3,
  FileStack,
  Fingerprint,
  MapPin,
  Scale,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { CanonicalPersonProfile, PersonMentionRecord } from '../types';

interface Props {
  profile: CanonicalPersonProfile;
  mentions: PersonMentionRecord[];
  onOpenMention: (mentionId: string) => void;
}

export function ProfileView({ profile, mentions, onOpenMention }: Props) {
  const linkedMentions = useMemo(
    () => mentions.filter((mention) => mention.suggestedIdentityId === profile.id),
    [mentions, profile.id],
  );

  return (
    <div className="id-screen">
      <header className="id-screen-header">
        <div>
          <div className="id-screen-kicker">Canonical person profile</div>
          <h1 className="id-screen-title">{profile.canonicalName}</h1>
          <p className="id-screen-subtitle">
            Evidence-backed person dossier with aliases, organizations, timeline, linked documents, and unresolved
            contradictions kept visible.
          </p>
        </div>
        <div className="id-callout">
          <ShieldCheck size={18} />
          <div>
            <strong>Confidence summary</strong>
            <span>{Math.round(profile.confidenceSummary * 100)}% across linked evidence and profile facts.</span>
          </div>
        </div>
      </header>

      <div className="id-profile-layout">
        <section className="id-profile-main">
          <article className="id-profile-hero">
            <div className="id-avatar">
              <UserRound size={28} />
            </div>
            <div className="id-profile-heading">
              <div className="id-token-row">
                {profile.aliases.map((alias) => (
                  <span key={alias} className="id-token">
                    {alias}
                  </span>
                ))}
              </div>
              <div className="id-attribute-grid">
                <AttributeColumn icon={<Building2 size={14} />} label="Organizations" values={profile.organizations} />
                <AttributeColumn icon={<Fingerprint size={14} />} label="Roles" values={profile.roles} />
                <AttributeColumn icon={<MapPin size={14} />} label="Locations" values={profile.locations} />
              </div>
            </div>
          </article>

          <article className="id-surface-card">
            <div className="id-card-header">
              <div>
                <div className="id-card-kicker">Timeline of appearances</div>
                <h2 className="id-card-title">When and where this person enters the case record.</h2>
              </div>
              <Clock3 size={18} />
            </div>
            <div className="id-timeline-list">
              {profile.timeline.map((item) => (
                <div key={`${item.date}-${item.documentTitle}`} className="id-timeline-item">
                  <div className="id-timeline-date">{item.date}</div>
                  <div className="id-timeline-body">
                    <div className="id-timeline-event">{item.event}</div>
                    <div className="id-timeline-meta">
                      {item.documentTitle} • {Math.round(item.confidence * 100)}% confidence
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="id-surface-card">
            <div className="id-card-header">
              <div>
                <div className="id-card-kicker">Evidence</div>
                <h2 className="id-card-title">Compact dossier evidence pack</h2>
              </div>
              <FileStack size={18} />
            </div>
            <div className="id-evidence-grid">
              {profile.evidence.map((evidence) => (
                <article key={evidence.id} className="id-evidence-card">
                  <div className="id-evidence-meta">
                    <span>{evidence.source}</span>
                    <span>
                      {evidence.date ?? 'Undated'} • {evidence.language}
                    </span>
                  </div>
                  <p>{evidence.snippet}</p>
                </article>
              ))}
            </div>
          </article>
        </section>

        <aside className="id-profile-side">
          <article className="id-surface-card">
            <div className="id-card-header compact">
              <div>
                <div className="id-card-kicker">Profile aggregation</div>
                <h3 className="id-card-title">Facts promoted from evidence only</h3>
              </div>
              <Scale size={16} />
            </div>
            <div className="id-fact-list">
              {profile.facts.map((fact) => (
                <div key={`${fact.label}-${fact.value}`} className="id-fact-row">
                  <div>
                    <div className="id-fact-label">{fact.label}</div>
                    <div className="id-fact-value">{fact.value}</div>
                  </div>
                  <div className="id-fact-confidence">{Math.round(fact.confidence * 100)}%</div>
                </div>
              ))}
            </div>
          </article>

          <article className="id-surface-card">
            <div className="id-card-header compact">
              <div>
                <div className="id-card-kicker">Linked documents</div>
                <h3 className="id-card-title">Cross-file context</h3>
              </div>
              <FileStack size={16} />
            </div>
            <div className="id-list">
              {profile.linkedDocuments.map((document) => (
                <div key={document.id} className="id-list-row static">
                  <div>
                    <div className="id-list-title">{document.title}</div>
                    <div className="id-list-detail">
                      {document.date} • {document.mentionCount} linked mentions
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="id-surface-card">
            <div className="id-card-header compact">
              <div>
                <div className="id-card-kicker">Contradictions and unresolved aliases</div>
                <h3 className="id-card-title">Do not collapse these silently</h3>
              </div>
              <AlertTriangle size={16} />
            </div>
            <div className="id-warning-stack">
              {profile.contradictions.map((contradiction) => (
                <div key={contradiction} className="id-warning-card">
                  {contradiction}
                </div>
              ))}
              {profile.unresolvedAliases.map((alias) => (
                <div key={alias} className="id-warning-card subtle">
                  Unresolved alias path: {alias}
                </div>
              ))}
              {!profile.contradictions.length && !profile.unresolvedAliases.length ? (
                <div className="id-empty-note">No current contradiction flags for this profile.</div>
              ) : null}
            </div>
          </article>

          <article className="id-surface-card">
            <div className="id-card-header compact">
              <div>
                <div className="id-card-kicker">Source mentions</div>
                <h3 className="id-card-title">Jump back to evidence review</h3>
              </div>
              <Fingerprint size={16} />
            </div>
            <div className="id-list">
              {linkedMentions.map((mention) => (
                <button key={mention.id} type="button" className="id-list-row" onClick={() => onOpenMention(mention.id)}>
                  <div>
                    <div className="id-list-title">{mention.rawMention}</div>
                    <div className="id-list-detail">
                      {mention.documentTitle} • {mention.language} • {Math.round(mention.confidence * 100)}%
                    </div>
                  </div>
                  <span className={`id-status-chip ${mention.status}`}>{mention.status}</span>
                </button>
              ))}
            </div>
          </article>
        </aside>
      </div>
    </div>
  );
}

function AttributeColumn({
  icon,
  label,
  values,
}: {
  icon: React.ReactNode;
  label: string;
  values: string[];
}) {
  return (
    <div className="id-attribute-column">
      <div className="id-attribute-title">
        {icon}
        <span>{label}</span>
      </div>
      <div className="id-token-row">
        {values.map((value) => (
          <span key={value} className="id-token">
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}
