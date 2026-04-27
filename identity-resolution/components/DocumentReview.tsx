import React, { useMemo } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  FileText,
  Languages,
  Link2,
  ScanSearch,
} from 'lucide-react';
import { CanonicalPersonProfile, PersonMentionRecord } from '../types';

interface Props {
  mentions: PersonMentionRecord[];
  snippets: Array<{
    id: string;
    title: string;
    date?: string;
    excerpt: string;
    mentionIds: string[];
  }>;
  profiles: CanonicalPersonProfile[];
  selectedMentionId: string;
  onSelectMention: (id: string) => void;
  onOpenProfile: (profileId: string) => void;
}

export function DocumentReview({
  mentions,
  snippets,
  profiles,
  selectedMentionId,
  onSelectMention,
  onOpenProfile,
}: Props) {
  const selectedMention = mentions.find((mention) => mention.id === selectedMentionId) ?? mentions[0];
  const selectedProfile = profiles.find((profile) => profile.id === selectedMention?.suggestedIdentityId);

  const documentMentions = useMemo(
    () => mentions.filter((mention) => mention.documentId === selectedMention.documentId),
    [mentions, selectedMention.documentId],
  );

  return (
    <div className="id-screen">
      <header className="id-screen-header">
        <div>
          <div className="id-screen-kicker">Document entity extraction review</div>
          <h1 className="id-screen-title">Inspect mention quality before identity resolution hardens into profiles.</h1>
          <p className="id-screen-subtitle">
            Raw mention, normalized mention, language, evidence, and candidate scoring stay visible in one review loop.
          </p>
        </div>
      </header>

      <div className="id-review-layout">
        <section className="id-review-main">
          <article className="id-surface-card">
            <div className="id-card-header">
              <div>
                <div className="id-card-kicker">Document extraction preview</div>
                <h2 className="id-card-title">{selectedMention.documentTitle}</h2>
              </div>
              <span className="id-pill-inline">
                <FileText size={12} />
                {documentMentions.length} mentions
              </span>
            </div>

            <div className="id-excerpt-stack">
              {snippets
                .filter((snippet) => snippet.id === selectedMention.documentId)
                .map((snippet) => (
                  <article key={snippet.id} className="id-excerpt-card">
                    <div className="id-excerpt-head">{snippet.title}</div>
                    {snippet.date ? <div className="id-list-detail">{snippet.date}</div> : null}
                    <p className="id-excerpt-copy">
                      {renderHighlightedExcerpt(snippet.excerpt, snippet.mentionIds, mentions, onSelectMention)}
                    </p>
                  </article>
                ))}
            </div>
          </article>

          <article className="id-surface-card">
            <div className="id-card-header">
              <div>
                <div className="id-card-kicker">Detected person mentions</div>
                <h2 className="id-card-title">Evidence-first review table</h2>
              </div>
              <span className="id-legend-copy">Language, confidence, and status stay visible while triaging.</span>
            </div>

            <div className="id-table-wrap">
              <table className="id-review-table">
                <thead>
                  <tr>
                    <th>Raw mention</th>
                    <th>Normalized</th>
                    <th>Language</th>
                    <th>Confidence</th>
                    <th>Suggested identity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {documentMentions.map((mention) => (
                    <tr
                      key={mention.id}
                      className={mention.id === selectedMention.id ? 'selected' : ''}
                      onClick={() => onSelectMention(mention.id)}
                    >
                      <td>
                        <div className="id-cell-title">{mention.rawMention}</div>
                        <div className="id-cell-subtle">{mention.sourceSnippet}</div>
                      </td>
                      <td>{mention.normalizedMention}</td>
                      <td>{mention.language}</td>
                      <td>
                        <div className="id-confidence-stack">
                          <div className="id-confidence-bar">
                            <span style={{ width: `${mention.confidence * 100}%` }} />
                          </div>
                          <span>{Math.round(mention.confidence * 100)}%</span>
                        </div>
                      </td>
                      <td>
                        {profiles.find((profile) => profile.id === mention.suggestedIdentityId)?.canonicalName ?? 'Unresolved'}
                      </td>
                      <td>
                        <span className={`id-status-chip ${mention.status}`}>{mention.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <aside className="id-resolution-panel">
          <div className="id-panel-card">
            <div className="id-panel-topline">
              <span className="id-panel-kicker">Person resolution side panel</span>
              <span className={`id-status-chip ${selectedMention.status}`}>{selectedMention.status}</span>
            </div>
            <h2 className="id-panel-title">{selectedMention.rawMention}</h2>
            <div className="id-panel-meta-grid">
              <div>
                <strong>Normalized</strong>
                <span>{selectedMention.normalizedMention}</span>
              </div>
              <div>
                <strong>Language</strong>
                <span>{selectedMention.language}</span>
              </div>
              <div>
                <strong>Page</strong>
                <span>{selectedMention.page ?? 'n/a'}</span>
              </div>
              <div>
                <strong>Confidence</strong>
                <span>{Math.round(selectedMention.confidence * 100)}%</span>
              </div>
            </div>
            <blockquote className="id-source-quote">"{selectedMention.sourceSnippet}"</blockquote>

            <div className="id-context-row">
              {selectedMention.surroundingEntities.map((entity) => (
                <span key={entity} className="id-token">
                  {entity}
                </span>
              ))}
            </div>
          </div>

          <div className="id-panel-card">
            <div className="id-card-header compact">
              <div>
                <div className="id-card-kicker">Candidate matching</div>
                <h3 className="id-card-title">Score breakdown and merge explanation</h3>
              </div>
              <ScanSearch size={16} />
            </div>

            <div className="id-candidate-stack">
              {selectedMention.alternatives.map((candidate) => (
                <article key={candidate.id} className="id-candidate-panel">
                  <div className="id-candidate-header">
                    <div>
                      <div className="id-candidate-name">{candidate.canonicalName}</div>
                      <div className="id-candidate-meta">
                        {candidate.organizations.join(' • ') || 'No org evidence'} • {candidate.roles.join(' • ')}
                      </div>
                    </div>
                    <button type="button" className="id-link-button" onClick={() => onOpenProfile(candidate.id)}>
                      Open profile <ArrowUpRight size={13} />
                    </button>
                  </div>

                  <div className="id-score-grid">
                    <ScoreMetric label="Alias similarity" value={candidate.scoreBreakdown.aliasSimilarity} />
                    <ScoreMetric label="Transliteration" value={candidate.scoreBreakdown.transliterationSimilarity} />
                    <ScoreMetric label="Organization overlap" value={candidate.scoreBreakdown.organizationOverlap} />
                    <ScoreMetric label="Location overlap" value={candidate.scoreBreakdown.locationOverlap} />
                    <ScoreMetric label="Role/title overlap" value={candidate.scoreBreakdown.roleTitleOverlap} />
                    <ScoreMetric label="Timeline overlap" value={candidate.scoreBreakdown.timelineOverlap} />
                  </div>

                  <div className="id-candidate-summary">
                    <div className="id-summary-row">
                      <CheckCircle2 size={14} />
                      <span>{candidate.matchReasons.join(' • ')}</span>
                    </div>
                    {candidate.conflictReasons?.length ? (
                      <div className="id-summary-row danger">
                        <CircleAlert size={14} />
                        <span>{candidate.conflictReasons.join(' • ')}</span>
                      </div>
                    ) : null}
                    <div className="id-summary-row muted">
                      <Link2 size={14} />
                      <span>{candidate.scoreBreakdown.explanation}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {selectedProfile ? (
              <div className="id-recommended-merge">
                <div className="id-panel-kicker">Suggested identity</div>
                <button type="button" className="id-inline-profile prominent" onClick={() => onOpenProfile(selectedProfile.id)}>
                  <span>{selectedProfile.canonicalName}</span>
                  <span className="id-inline-score">{Math.round(selectedProfile.confidenceSummary * 100)}%</span>
                </button>
              </div>
            ) : null}
          </div>

          <div className="id-panel-card">
            <div className="id-card-header compact">
              <div>
                <div className="id-card-kicker">Analyst guardrails</div>
                <h3 className="id-card-title">Uncertainty stays visible</h3>
              </div>
              <Languages size={16} />
            </div>
            <ul className="id-guidance-list">
              <li>Do not merge if the surname is shared but organization context conflicts.</li>
              <li>Keep transliteration-only matches unresolved until at least one contextual field corroborates them.</li>
              <li>Short-form or pronoun references should not overwrite higher-confidence evidence.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function renderHighlightedExcerpt(
  excerpt: string,
  mentionIds: string[],
  mentions: PersonMentionRecord[],
  onSelectMention: (id: string) => void,
) {
  let rendered = excerpt;
  mentionIds.forEach((mentionId) => {
    const mention = mentions.find((item) => item.id === mentionId);
    if (!mention) {
      return;
    }
    rendered = rendered.replace(mention.rawMention, `__HIGHLIGHT__${mentionId}__${mention.rawMention}__END__`);
  });

  return rendered.split(/(__HIGHLIGHT__.*?__END__)/g).map((part, index) => {
    const match = part.match(/^__HIGHLIGHT__(.+?)__(.+)__END__$/);
    if (!match) {
      return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    }
    const [, mentionId, label] = match;
    const mention = mentions.find((item) => item.id === mentionId);
    return (
      <button
        key={mentionId}
        type="button"
        className={`id-inline-mention ${mention?.status ?? 'resolved'}`}
        onClick={() => onSelectMention(mentionId)}
      >
        {label}
      </button>
    );
  });
}

function ScoreMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="id-score-card">
      <div className="id-score-label">{label}</div>
      <div className="id-score-value">{Math.round(value * 100)}%</div>
      <div className="id-score-bar">
        <span style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}
