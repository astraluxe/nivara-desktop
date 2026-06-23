import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from '../../lib/krewDb';
import ServiceSetupModal from './ServiceSetupModal';
import { consumeServiceRequest } from '../../lib/connectAppsRequest';

interface ServiceDef {
  id:     string;
  name:   string;
  desc:   string;
  note?:  string;
  tags:   string[];
  usedBy: string[];
}

// ─── Real brand SVG logos ─────────────────────────────────────────────────────

function PlatformLogo({ id, className = 'w-5 h-5' }: { id: string; className?: string }) {
  const base = { fill: 'currentColor', className, 'aria-hidden': true };
  switch (id) {
    case 'gemini':
      return <svg {...base} viewBox="0 0 28 28"><path d="M14 2C14 2 13.1 9.2 10 12.8 6.9 16.4 0 16 0 16c0 0 6.9.4 10 4 3.1 3.6 4 10 4 10s.9-6.4 4-10c3.1-3.6 10-4 10-4s-6.9.4-10-3.2C14.9 9.2 14 2 14 2z"/></svg>;
    case 'openai':
      return <svg {...base} viewBox="0 0 24 24"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.83 14.18A4.485 4.485 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387 2.02-1.168a.076.076 0 0 1 .071 0l4.003 2.309a4.485 4.485 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.385-.681zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.003-2.309a4.476 4.476 0 0 1 6.937 4.144zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.476 4.476 0 0 1 7.339-3.44l-.141.085L8.97 5.49a.798.798 0 0 0-.396.681zm1.097-2.365l2.602-1.5 2.607 1.496v2.999l-2.597 1.5-2.607-1.5z"/></svg>;
    case 'claude':
      return <svg {...base} viewBox="0 0 46 46"><path d="M32.73 0h-8.31L14.13 27.31h8.31L32.73 0zm-19.18 0H5.24L0 14.9h8.31L13.55 0zM40.76 0h-8.03L27.5 13.89l4.02 11.01L40.76 0zM23 32.11l-4.18-11.45H10.5L23 46l12.5-25.34h-8.32L23 32.11z"/></svg>;
    case 'brave':
      return <svg {...base} viewBox="0 0 24 24"><path d="M21.86 5.17l-1.35-1.27a.85.85 0 0 0-1.16 0L18 5.17a.43.43 0 0 1-.58 0l-1.35-1.27a.85.85 0 0 0-1.16 0l-1.35 1.27a.43.43 0 0 1-.58 0l-1.35-1.27a.85.85 0 0 0-1.16 0L9.12 5.17a.43.43 0 0 1-.58 0L7.19 3.9a.85.85 0 0 0-1.16 0L3.79 6.06l2.09 7.56L8 22.08C8.72 24.17 10.14 24 12 24h12c1.86 0 3.28.17 4-1.92l2.12-8.46 2.09-7.56-2.24-2.16a.85.85 0 0 0-1.16 0l-1.35 1.27a.43.43 0 0 1-.58 0zm-7.66 13.47l-2.48-7.36h-.01L10.47 8.5h13.06l-1.24 2.78h.01l-2.48 7.36-.06.16L18 21.5l-3.76-2.7-.04-.16z"/></svg>;
    case 'gmail':
      return <svg {...base} viewBox="0 0 24 24"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>;
    case 'google':
      return <svg {...base} viewBox="0 0 24 24"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>;
    case 'notion':
      return <svg {...base} viewBox="0 0 24 24"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.62c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933z"/></svg>;
    case 'slack':
      return <svg {...base} viewBox="0 0 24 24"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522zm2.521-10.123a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.123 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.123a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>;
    case 'github':
      return <svg {...base} viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>;
    case 'linear':
      return <svg {...base} viewBox="0 0 100 100"><path d="M1.22 61.4 38.6 98.78a3.56 3.56 0 0 0 5-.18L98.6 43.6a3.56 3.56 0 0 0-.18-5.18L1.4 56.4a3.56 3.56 0 0 0-.18 5zM0 47.09 52.91 100a50 50 0 0 1-52.91-52.91zM6.27 37.2l56.53 56.53a50 50 0 0 0 30.63-30.63L6.27 6.57A50 50 0 0 0 6.27 37.2z"/></svg>;
    case 'airtable':
      return <svg {...base} viewBox="0 0 24 24"><path d="M11.984.024L.145 5.258a.48.48 0 0 0 0 .87l11.913 5.234a.48.48 0 0 0 .384 0l11.913-5.234a.48.48 0 0 0 0-.87L12.368.024a.48.48 0 0 0-.384 0zM.048 8.393v6.961c0 .275.296.459.544.343l10.8-5.016a.48.48 0 0 0 .272-.435V3.284a.384.384 0 0 0-.544-.342L.32 7.958a.48.48 0 0 0-.272.435zm23.904 0a.48.48 0 0 0-.272-.435L13.368 2.942a.384.384 0 0 0-.544.342v6.962c0 .188.109.36.272.435l10.8 5.016a.384.384 0 0 0 .544-.343V8.393z"/></svg>;
    case 'twitter':
      return <svg {...base} viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
    case 'linkedin':
      return <svg {...base} viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;
    case 'reddit':
      return <svg {...base} viewBox="0 0 24 24"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>;
    case 'stripe':
      return <svg {...base} viewBox="0 0 24 24"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"/></svg>;
    case 'discord':
      return <svg {...base} viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.09.12 18.12.143 18.14a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>;
    case 'figma':
      return <svg {...base} viewBox="0 0 24 24"><path d="M15.852 8.981h-4.588V0h4.588c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.491-4.49 4.491zM12.735 7.51h3.117c1.665 0 3.019-1.355 3.019-3.019s-1.354-3.019-3.019-3.019h-3.117V7.51zm0 1.471H8.148c-2.476 0-4.49-2.014-4.49-4.49S5.672 0 8.148 0h4.588v8.981zm-4.587-7.51c-1.665 0-3.019 1.355-3.019 3.019s1.354 3.019 3.019 3.019h3.117V1.471H8.148zm4.587 15.019H8.148c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h4.588v8.98zM8.148 8.981c-1.665 0-3.019 1.355-3.019 3.019s1.354 3.019 3.019 3.019h3.117V8.981H8.148zM8.172 24c-2.489 0-4.515-2.014-4.515-4.49s2.026-4.49 4.515-4.49h4.563v4.49c0 2.476-2.014 4.49-4.563 4.49zm0-7.509c-1.665 0-3.019 1.355-3.019 3.019 0 1.663 1.354 2.985 3.019 2.985 1.663 0 3.092-1.322 3.092-3.009V16.49l-3.092.001zm7.704 0h-.001c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49 4.49 2.014 4.49 4.49-2.014 4.49-4.49 4.49zm0-7.509c-1.665 0-3.019 1.355-3.019 3.019s1.354 3.019 3.019 3.019 3.019-1.355 3.019-3.019-1.354-3.019-3.019-3.019z"/></svg>;
    case 'shopify':
      return <svg {...base} viewBox="0 0 24 24"><path d="M15.337 2.585c-.013-.073-.077-.11-.14-.11-.063 0-1.292-.024-1.292-.024s-1.035-.997-1.14-1.1c-.037-.036-.086-.054-.136-.058l-.745 15.23 4.723-1.02s-1.257-12.844-1.27-12.918zM12.69.805l-.59.183a3.52 3.52 0 0 0-.228-.555C11.515.005 11.11-.18 10.646-.18c-.031 0-.063.003-.095.007A1.46 1.46 0 0 0 9.905-.6c-.698.096-1.386.78-1.948 2.12-.393.944-.69 2.13-.775 3.049L5.05 5.28c-.522.164-.538.18-.606.665C4.38 6.37 2.87 18.55 2.87 18.55l10.14 1.9.704-19.65A.27.27 0 0 0 13.6.74l-.91.065zM10.43 1.88c-.463 1.123-.769 2.432-.86 3.262L7.536 5.7c.393-1.5 1.094-2.97 1.985-3.65.252-.19.519-.305.775-.32a.93.93 0 0 1 .134.15zm-.994-.48c.12 0 .225.03.316.085-.247.13-.491.328-.72.575-.648.712-1.148 1.82-1.439 2.98l-1.51.468c.37-1.696 1.282-4.005 3.353-4.108zm.598 9.648l-2.08-.502c.083-.45.356-.855.71-1.02.173-.083.354-.11.53-.075.405.079.688.558.733 1.18a3.78 3.78 0 0 1 .107.417zm4.463 7.483l-9.15-2.193L9.01 6.78l2.31-.715a.09.09 0 0 1 .113.065l.01.04 2.067 12.36z"/></svg>;
    case 'serper':
      return <svg {...base} viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="7" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M7.5 10.5h6M10.5 7.5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
    case 'vercel':
      return <svg {...base} viewBox="0 0 24 24"><path d="M24 22.525H0l12-21.05 12 21.05z"/></svg>;
    case 'runway':
      return <svg {...base} viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M8 9l5 3-5 3V9z" fill="currentColor"/></svg>;
    case 'elevenlabs':
      return <svg {...base} viewBox="0 0 24 24"><rect x="4" y="4" width="3" height="16" rx="1" fill="currentColor"/><rect x="10.5" y="2" width="3" height="20" rx="1" fill="currentColor"/><rect x="17" y="6" width="3" height="12" rx="1" fill="currentColor"/></svg>;
    case 'heygen':
      return <svg {...base} viewBox="0 0 24 24"><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/><path d="M16 10l3.5 2-3.5 2V10z" fill="currentColor"/></svg>;
    case 'did':
      return <svg {...base} viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none"/><circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M7 19c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/></svg>;
    case 'higgsfield':
      return <svg {...base} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="4" cy="6" r="1.8" fill="currentColor" opacity=".6"/><circle cx="20" cy="6" r="1.8" fill="currentColor" opacity=".6"/><circle cx="4" cy="18" r="1.8" fill="currentColor" opacity=".6"/><circle cx="20" cy="18" r="1.8" fill="currentColor" opacity=".6"/><path d="M12 9V6M12 18v-3M9 12H6M18 12h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>;
    case 'instagram':
      return <svg {...base} viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>;
    default:
      return <span className="text-sm font-bold leading-none">{id[0].toUpperCase()}</span>;
  }
}

// ─── Brand accent colors ──────────────────────────────────────────────────────

const BRAND_COLOR: Record<string, string> = {
  gemini:   'text-blue-400',
  openai:   'text-emerald-400',
  claude:   'text-orange-400',
  brave:    'text-orange-500',
  gmail:    'text-red-400',
  google:   'text-blue-400',
  notion:   'text-nv-text',
  slack:    'text-purple-400',
  github:   'text-nv-text',
  linear:   'text-violet-400',
  airtable: 'text-cyan-400',
  twitter:  'text-nv-text',
  linkedin: 'text-blue-500',
  reddit:   'text-orange-500',
  telegram:   'text-sky-400',
  twilio:     'text-red-400',
  hubspot:    'text-orange-400',
  stripe:     'text-violet-400',
  discord:    'text-indigo-400',
  figma:      'text-pink-400',
  shopify:    'text-emerald-400',
  serper:     'text-blue-400',
  crunchbase: 'text-orange-400',
  jira:       'text-blue-500',
  vercel:     'text-nv-text',
  runway:     'text-sky-400',
  heygen:     'text-violet-400',
  elevenlabs: 'text-amber-400',
  did:        'text-pink-400',
  higgsfield: 'text-cyan-400',
  instagram:  'text-pink-500',
};

// ─── Service definitions ──────────────────────────────────────────────────────

const SERVICES: ServiceDef[] = [
  // AI providers
  { id: 'gemini',   name: 'Gemini (Google AI)',  desc: 'Powers Krew, Guard and Automation. Free tier — generous Flash model allowance.',       tags: ['ai','llm','google'],                     usedBy: ['Krew','Automation','Guard'] },
  { id: 'openai',   name: 'OpenAI (GPT-4o)',     desc: 'Powers Krew and Automation with GPT-4o mini. Pay-per-use, very affordable.',            tags: ['ai','llm'],                              usedBy: ['Krew','Automation','Guard'] },
  { id: 'claude',   name: 'Claude (Anthropic)',  desc: 'Powers Krew and Automation with Claude Haiku. Pay-per-use.',                            tags: ['ai','llm'],                              usedBy: ['Krew','Automation','Guard'] },
  // Tools
  { id: 'brave',    name: 'Web Search',          desc: 'Brave Search — 2K free searches/month. Krew uses this for any web lookup.',             tags: ['search'],                                usedBy: ['Krew'] },
  { id: 'gmail',    name: 'Gmail',               desc: 'Read and search inbox via IMAP. Used by Automation email triggers and Guard.',           note: 'Read-only. Connect Google Suite below to send emails.',           tags: ['email','google'],                        usedBy: ['Krew','Automation','Guard'] },
  { id: 'google',   name: 'Google Suite',        desc: 'Calendar, Sheets, Drive, Slides — connected once, works across all four.',              note: 'Also required to send emails via Krew agents.',                   tags: ['calendar','sheets','drive','slides'],     usedBy: ['Krew','Automation'] },
  { id: 'notion',   name: 'Notion',              desc: 'Search pages, read databases, create pages. Also used by Automation → Notion output.',  tags: ['notes','docs'],                          usedBy: ['Krew','Automation'] },
  { id: 'slack',    name: 'Slack',               desc: 'Read channels, send messages, search workspace. Used by Automation → Slack output.',    tags: ['chat','messaging'],                      usedBy: ['Krew','Automation'] },
  { id: 'github',   name: 'GitHub',              desc: 'List repos, read files, create issues, search code. Used by Guard vuln scanner.',       tags: ['code','git'],                            usedBy: ['Krew','Guard'] },
  { id: 'linear',   name: 'Linear',              desc: 'Fetch and create issues in your Linear workspace.',                                      tags: ['issues','project'],                      usedBy: ['Krew'] },
  { id: 'airtable', name: 'Airtable',            desc: 'Read and write records in any Airtable base.',                                          tags: ['data','spreadsheet'],                    usedBy: ['Krew','Automation'] },
  // Social / Marketing
  { id: 'twitter',  name: 'X (Twitter)',         desc: 'Post tweets, read timeline, search mentions. Used by Krew and Automation.',             tags: ['social','twitter','x','marketing'],      usedBy: ['Krew','Automation'] },
  { id: 'linkedin', name: 'LinkedIn',            desc: 'Post to your feed, read your profile. Used by Krew for content publishing.',            tags: ['social','linkedin','marketing'],          usedBy: ['Krew','Automation'] },
  // Automation outputs
  { id: 'telegram', name: 'Telegram',            desc: 'Send messages via a Telegram bot. Used by Automation → Telegram output.',               tags: ['chat','messaging','automation'],          usedBy: ['Automation'] },
  { id: 'twilio',   name: 'Twilio (SMS)',        desc: 'Send SMS messages via Twilio. Used by Automation → SMS output.',                         tags: ['sms','messaging','automation'],           usedBy: ['Automation'] },
  { id: 'hubspot',  name: 'HubSpot CRM',         desc: 'Create contacts, deals, and notes in HubSpot. Used by Automation → HubSpot output.',     tags: ['crm','sales','automation'],              usedBy: ['Automation'] },
  // Payments & E-commerce
  { id: 'stripe',   name: 'Stripe',              desc: 'Payment triggers — fire automations on payment success, failure, refund, or churn events.',  tags: ['payments','automation'],                 usedBy: ['Automation'] },
  { id: 'shopify',  name: 'Shopify',             desc: 'Read products, orders, and customer data from your Shopify store.',                           tags: ['ecommerce','sales'],                     usedBy: ['Krew'] },
  // Communication
  { id: 'discord',  name: 'Discord',             desc: 'Post to a Discord channel via webhook. Used by Automation → Discord output.',                tags: ['chat','messaging','automation'],          usedBy: ['Automation'] },
  // Design
  { id: 'figma',    name: 'Figma',               desc: 'Read design files, inspect components, and export assets from your Figma workspace.',         tags: ['design','ui'],                           usedBy: ['Krew'] },
  // Project management
  { id: 'jira',     name: 'Jira (Atlassian)',    desc: 'Create and read issues, update sprint tickets, and track bugs in Jira Cloud.',                tags: ['issues','project','engineering'],         usedBy: ['Krew'] },
  // Search & Data
  { id: 'serper',   name: 'Serper (Google Search)', desc: 'Google Search API — better results for Research agent. 2.5K free searches/month.',      note: 'Improves research quality over the default DuckDuckGo fallback.', tags: ['search'],  usedBy: ['Krew','Research'] },
  { id: 'crunchbase', name: 'Crunchbase',        desc: 'Startup and company data — funding rounds, investors, headcount. Used by Research agent.',   tags: ['data','research','startups'],            usedBy: ['Research'] },
  // Deployment
  { id: 'vercel',    name: 'Vercel',             desc: 'Deploy websites to a live URL in seconds. Krew\'s deploy agent pushes your site and returns a real vercel.app link.', note: 'Required for "deploy my website" tasks.', tags: ['deploy','hosting','website'],            usedBy: ['Krew'] },
  // Video AI MCPs
  { id: 'runway',    name: 'Runway ML',          desc: 'AI video generation — turn images or text into cinematic video clips. Used by Krew to create marketing videos.',      tags: ['video','ai','marketing','creative'],     usedBy: ['Krew'] },
  { id: 'heygen',    name: 'HeyGen',             desc: 'AI avatar video creation — generate talking-head marketing videos with a digital spokesperson using your brand.',     tags: ['video','ai','avatar','marketing'],        usedBy: ['Krew'] },
  { id: 'elevenlabs', name: 'ElevenLabs',        desc: 'AI voice synthesis — generate professional voiceovers for marketing videos, product demos, and ads.',                  tags: ['audio','voice','ai','marketing'],         usedBy: ['Krew'] },
  { id: 'did',        name: 'D-ID',               desc: 'Talking avatar videos — upload a photo and generate a realistic video with lip-sync audio. Great for product promos.', tags: ['video','ai','avatar','marketing'],        usedBy: ['Krew'] },
  { id: 'higgsfield', name: 'Higgsfield AI',      desc: 'MCP server with 30+ video models — Veo 3.1, Sora 2, Kling 3.0, Runway, and more. Best single MCP for video generation. URL: https://mcp.higgsfield.ai/mcp', note: 'Authenticate with your Higgsfield account when connecting.', tags: ['video','ai','mcp','marketing','creative'], usedBy: ['Krew'] },
  // Social publishing
  { id: 'instagram',  name: 'Instagram',          desc: 'Post photos, videos, Reels and Stories to your Instagram Business or Creator account. Krew can publish generated videos here.', note: 'Requires an Instagram Business or Creator account linked to a Facebook Page.', tags: ['social','video','marketing','publishing'],  usedBy: ['Krew','Automation'] },
];

interface Props { onClose?: () => void }

export default function ConnectApps({ onClose }: Props) {
  const [connected, setConnected] = useState<string[]>([]);
  const [setup,     setSetup]     = useState<string | null>(null);
  const [search,    setSearch]    = useState('');

  const reload = useCallback(() => {
    credentialStore.list().then(setConnected).catch(() => {});
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Auto-open setup modal if a tool pre-selected a service
  useEffect(() => {
    const pending = consumeServiceRequest();
    if (pending) setSetup(pending);
  }, []);

  async function disconnect(service: string) {
    await credentialStore.delete(service).catch(() => {});
    reload();
  }

  async function disconnectAll() {
    await Promise.all(connected.map(s => credentialStore.delete(s).catch(() => {})));
    reload();
  }

  const filtered = SERVICES.filter(s => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.tags.some(t => t.includes(q));
  });

  const connectedServices = filtered.filter(s =>  connected.includes(s.id));
  const availableServices = filtered.filter(s => !connected.includes(s.id));

  return (
    <>
      <div className="flex flex-col h-full bg-nv-bg">

        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 border-b border-nv-border shrink-0">
          <div>
            <h2 className="text-[13px] font-semibold text-nv-text">Connect Apps</h2>
            <p className="text-[10px] text-nv-faint">
              Used by Krew · Guard · Automation &nbsp;·&nbsp; Stored locally, never sent to adris.tech servers
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-nv-faint hover:text-nv-text text-xl transition-fast">×</button>
          )}
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-nv-border shrink-0 flex items-center gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-nv-faint pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search apps…"
              className="w-full bg-nv-surface border border-nv-border rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-nv-text outline-none focus:border-accent transition-fast placeholder:text-nv-faint"
            />
          </div>
          <span className="text-[10px] font-mono text-nv-faint shrink-0">{connected.length} connected</span>
        </div>

        {/* Token savings banner */}
        <div className="mx-5 mt-3 mb-1 flex items-start gap-3 rounded-xl bg-nv-surface border border-nv-border px-4 py-3 shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-nv-green mt-0.5 shrink-0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <p className="text-[11px] text-nv-muted leading-relaxed">
            <span className="text-nv-text font-medium">Connected apps use up to 4× fewer AI tokens.</span>
            {' '}Direct API calls are faster and more accurate than browser navigation — Gmail, LinkedIn, Notion, and Slack cost far less quota when connected.
          </p>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {connectedServices.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-nv-green" />
                  <p className="text-[11px] font-mono text-nv-muted uppercase tracking-widest">Connected · {connectedServices.length}</p>
                </div>
                <button onClick={disconnectAll} className="text-[10px] font-mono text-nv-muted hover:text-nv-bad transition-fast">Disconnect all</button>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {connectedServices.map(s => (
                  <ServiceCard key={s.id} service={s} isConnected onConnect={() => setSetup(s.id)} onDisconnect={() => disconnect(s.id)} />
                ))}
              </div>
            </section>
          )}

          {availableServices.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-nv-faint" />
                <p className="text-[11px] font-mono text-nv-faint uppercase tracking-widest">Available · {availableServices.length}</p>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {availableServices.map(s => (
                  <ServiceCard key={s.id} service={s} isConnected={false} onConnect={() => setSetup(s.id)} onDisconnect={() => {}} />
                ))}
              </div>
            </section>
          )}

          {filtered.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-nv-faint text-[11px]">No apps match your search.</p>
            </div>
          )}
        </div>
      </div>

      {setup && (
        <ServiceSetupModal service={setup} onDone={() => { setSetup(null); reload(); }} onClose={() => setSetup(null)} />
      )}
    </>
  );
}

type TestState = 'idle' | 'testing' | 'ok' | 'error';

function ServiceCard({ service, isConnected, onConnect, onDisconnect }: {
  service: ServiceDef; isConnected: boolean; onConnect: () => void; onDisconnect: () => void;
}) {
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMsg,   setTestMsg]   = useState('');
  const color = BRAND_COLOR[service.id] ?? 'text-nv-faint';

  async function runTest() {
    setTestState('testing');
    setTestMsg('');
    try {
      const creds = await credentialStore.get(service.id);
      const result = await invoke<string>('ping_service', {
        serviceId:  service.id,
        credsJson:  JSON.stringify(creds ?? {}),
      });
      setTestState('ok');
      setTestMsg(result);
    } catch (err: unknown) {
      setTestState('error');
      setTestMsg(String(err));
    }
  }

  // Reset test state when connection changes
  useEffect(() => { setTestState('idle'); setTestMsg(''); }, [isConnected]);

  return (
    <div className={`flex flex-col gap-2 p-3 rounded-xl border transition-fast ${
      isConnected ? 'bg-nv-surface border-nv-green/30' : 'bg-nv-surface border-nv-border hover:border-accent/40'
    }`}>
      {/* Logo + name + dot */}
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg bg-nv-bg flex items-center justify-center shrink-0 border border-nv-border ${color}`}>
          <PlatformLogo id={service.id} className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <p className="text-[12px] font-semibold text-nv-text leading-tight truncate">{service.name}</p>
          {isConnected && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-nv-green/15 text-nv-green font-mono leading-none shrink-0">●</span>}
        </div>
      </div>

      {/* Desc */}
      <p className="text-[11px] text-nv-muted leading-snug line-clamp-2">{service.desc}</p>
      {service.note && (
        <p className="text-[10px] text-nv-yellow leading-snug mt-1">
          <span className="font-semibold">Note:</span> {service.note}
        </p>
      )}

      {/* Test result */}
      {testState !== 'idle' && (
        <div className={`flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono leading-snug ${
          testState === 'testing' ? 'bg-nv-bg text-nv-muted' :
          testState === 'ok'      ? 'bg-nv-green/10 text-nv-green border border-nv-green/20' :
                                    'bg-nv-bad/10 text-nv-bad border border-nv-bad/20'
        }`}>
          <span className="shrink-0 mt-px">
            {testState === 'testing' ? '⟳' : testState === 'ok' ? '✓' : '✕'}
          </span>
          <span>{testState === 'testing' ? 'Testing connection…' : testMsg}</span>
        </div>
      )}

      {/* Tags + buttons */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex gap-1 flex-wrap">
          {service.usedBy.map(m => (
            <span key={m} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-nv-bg border border-nv-border text-nv-faint">{m}</span>
          ))}
        </div>
        {isConnected ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={runTest}
              disabled={testState === 'testing'}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-mono transition-fast ${
                testState === 'ok'    ? 'border-nv-green/40 text-nv-green bg-nv-green/8' :
                testState === 'error' ? 'border-nv-bad/40 text-nv-bad bg-nv-bad/8' :
                                        'border-nv-border text-nv-muted hover:border-accent/50 hover:text-accent'
              }`}
            >
              {testState === 'testing' ? '…' : testState === 'ok' ? '✓ OK' : testState === 'error' ? '✕ Retry' : 'Test'}
            </button>
            <button onClick={onDisconnect} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-nv-border shrink-0 text-nv-muted hover:border-nv-bad hover:text-nv-bad transition-fast font-mono">
              Disconnect
            </button>
          </div>
        ) : (
          <button onClick={onConnect} className="text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white shrink-0 hover:bg-accent/85 transition-fast font-mono font-medium">
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
