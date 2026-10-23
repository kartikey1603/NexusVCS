import React from 'react';
import { Link } from 'react-router-dom';

export default function RepoCard({ repo }) {
  const owner = repo.ownerId?.username || 'you';
  return <article className="repo-card">
    <div className="repo-card-top"><Link className="repo-name" to={`/${owner}/${repo.slug}`}>{owner} / {repo.name}</Link><div className="repo-card-badges"><span className={`badge ${repo.visibility}`}>{repo.visibility}</span>{repo.isOwner === false && <span className="badge role">collaborator</span>}</div></div>
    <p>{repo.description || 'No description.'}</p>
    <div className="muted">Updated {new Date(repo.updatedAt).toLocaleString()}</div>
    <Link className="text-link" to={`/${owner}/${repo.slug}`}>Open repository →</Link>
  </article>;
}
