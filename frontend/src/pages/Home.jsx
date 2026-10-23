import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import Logo from '../components/Logo.jsx';

export default function Home() {
  const { user } = useAuth();
  const repoTarget = user ? '/my-repositories' : '/explore';
  return <section className="hero page-narrow">
    <div className="eyebrow">Developer tool · version control · large assets</div>
    <h1><Logo size={32} /></h1>
    <p className="hero-copy">Version control for code and large digital assets. Store code, store large files, and lock assets while working.</p>
    <div className="actions"><Link className="button primary" to={user ? '/create-repository' : '/signup'}>Create Repository</Link><Link className="button" to="/explore">Explore Repositories</Link></div>
    <div className="feature-grid">
      <Link className="feature-card" to="/explore"><strong>Repositories</strong><span>Public and private repositories with owner and collaborator access.</span></Link>
      <Link className="feature-card" to={user ? '/my-repositories' : '/signup'}><strong>Code editing</strong><span>Open, edit and save code and text files right in the browser.</span></Link>
      <Link className="feature-card" to={repoTarget}><strong>Version control</strong><span>Staged changes, commits, history, file versions, push, pull, update and revert.</span></Link>
      <Link className="feature-card" to={repoTarget}><strong>File locking</strong><span>Server-side atomic locking prevents conflicting edits.</span></Link>
      <Link className="feature-card" to={repoTarget}><strong>Collaboration</strong><span>Owners add or remove collaborators by username.</span></Link>
      <Link className="feature-card" to={user ? '/my-repositories' : '/login'}><strong>Large-file / S3</strong><span>Direct browser-to-S3 multipart uploads for files above the size threshold.</span></Link>
    </div>
    <div className="about-section">
      <h2 className="section-title">About NexusVCS</h2>
      <p>NexusVCS is a lightweight, GitHub-style version-control platform for teams that need to manage both source code and large binary assets in one place. Every repository tracks a full history of commits and file versions, so nothing is ever silently overwritten: uploads, edits, deletions, and restores are staged first and only become permanent history once you explicitly push them with a commit message.</p>
      <p>Collaboration is built in — owners can add collaborators by username, and file locking prevents two people from editing the same file at once. For large files, NexusVCS uploads directly from your browser to S3 using multipart upload, so multi-gigabyte assets never have to pass through the application server. The result is a fast, minimal workflow: stage your changes, review them, and push — with the safety of full version history and revert whenever you need it.</p>
    </div>
  </section>;
}
