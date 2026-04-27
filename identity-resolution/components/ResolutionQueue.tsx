import React, { useMemo } from 'react';
import { AlertTriangle, ArrowRightLeft, Filter, Layers2, UserRoundSearch } from 'lucide-react';
import { CanonicalPersonProfile, ConflictQueueItem, PersonMentionRecord } from '../types';

interface Props {
  mentions: PersonMentionRecord[];
  queueItems: ConflictQueueItem[];
  profiles: CanonicalPersonProfile[];
  filter: 'all' | 'conflict' | 'uncertain' | 'unresolved';
  onChangeFilter: (filter: 'all' | 'conflict' | 'uncertain' | 'unresolved') => void;
  onSelectMention: (mentionId: string) => void;
  onOpenProfile: (profileId: string) => void;
}

export function ResolutionQueue({
  mentions,
  queueItems,
  profiles,
  filter,
  onChangeFilter,
  onSelectMention,
  onOpenProfile,
}: Props) {
  const filteredMentions = useMemo(() => {
    if (filter === 'all') {
      return mentions.filter((mention) => mention.status !== 'resolved');
    }
    return mentions.filter((mention) => mention.status === filter);
  }, [filter, mentions]);

  return (
    <div className="id-screen">
      <header className="id-screen-header">
        <div>
          <div className="id-screen-kicker">Conflict / unresolved queue</div>
          <h1 className="id-screen-title">Keep ambiguity reviewable until the evidence justifies a merge.</h1>
          <p className="id-screen-subtitle">
            This queue surfaces uncertain, unresolved, and conflicting identities with candidate paths and contradiction
            context.
          </p>
        </div>
      </header>

      <section className="id-filter-row">
        {(['all', 'conflict', 'uncertain', 'unresolved'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={`id-filter-pill ${filter === option ? 'active' : ''}`}
            onClick={() => onChangeFilter(option)}
          >
            <Filter size={13} />
            {option}
          </button>
        ))}
      </section>

      <div className="id-dashboard-grid">
        <article className="id-surface-card">
          <div className="id-card-header">
            <div>
              <div className="id-card-kicker">Review queue</div>
              <h2 className="id-card-title">Mention-level resolution work</h2>
            </div>
            <UserRoundSearch size={18} />
          </div>
          <div className="id-list">
            {filteredMentions.map((mention) => (
              <button key={mention.id} type="button" className="id-list-row" onClick={() => onSelectMention(mention.id)}>
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

        <div className="id-queue-side-stack">
          <article className="id-surface-card">
            <div className="id-card-header compact">
              <div>
                <div className="id-card-kicker">Conflict reasons</div>
                <h3 className="id-card-title">Analyst queue</h3>
              </div>
              <AlertTriangle size={16} />
            </div>
            <div className="id-list">
              {queueItems.map((item) => (
                <button key={item.mentionId} type="button" className="id-list-row" onClick={() => onSelectMention(item.mentionId)}>
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
            <div className="id-card-header compact">
              <div>
                <div className="id-card-kicker">Duplicate candidate watch</div>
                <h3 className="id-card-title">Profiles with unresolved alias trees</h3>
              </div>
              <Layers2 size={16} />
            </div>
            <div className="id-list">
              {profiles
                .filter((profile) => profile.unresolvedAliases.length > 0)
                .map((profile) => (
                  <button key={profile.id} type="button" className="id-list-row" onClick={() => onOpenProfile(profile.id)}>
                    <div>
                      <div className="id-list-title">{profile.canonicalName}</div>
                      <div className="id-list-detail">{profile.unresolvedAliases.join(' • ')}</div>
                    </div>
                    <span className="id-pill-inline">
                      <ArrowRightLeft size={12} />
                      {profile.unresolvedAliases.length}
                    </span>
                  </button>
                ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
