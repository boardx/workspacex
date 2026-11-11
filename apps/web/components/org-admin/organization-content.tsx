import * as React from 'react';
import type {LucideIcon} from 'lucide-react';
import {cn} from '@/lib/utils';

/** Content primitives only. Navigation and permissions remain owned by their existing shells. */
export function OrganizationContent({children,className,testId}:{children:React.ReactNode;className?:string;testId?:string}){
 return <div data-testid={testId} className={cn('mx-auto flex min-w-0 w-full max-w-screen-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8',className)}>{children}</div>;
}
export function OrganizationPageHeader({title,description,icon:Icon,actions}:{title:string;description?:React.ReactNode;icon?:LucideIcon;actions?:React.ReactNode}){
 return <header className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-4">{Icon&&<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-background-foreground"><Icon aria-hidden className="h-6 w-6"/></span>}<div className="min-w-0"><h1 className="text-24 font-semibold tracking-tight text-background-foreground sm:text-30">{title}</h1>{description&&<div className="mt-1 text-13 leading-relaxed text-muted-foreground">{description}</div>}</div></div>{actions&&<div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}</header>;
}
export function OrganizationStatCard({label,value,description,icon:Icon,testId}:{label:React.ReactNode;value:React.ReactNode;description?:React.ReactNode;icon?:LucideIcon;testId?:string}){
 return <div data-testid={testId} className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-2 text-13 text-muted-foreground">{Icon&&<Icon aria-hidden className="h-4 w-4 shrink-0"/>}<span>{label}</span></div><div className="mt-3 text-30 font-semibold tracking-tight text-card-foreground tabular-nums">{value}</div>{description&&<div className="mt-2 text-12 leading-relaxed text-muted-foreground">{description}</div>}</div>;
}
export function OrganizationSection({title,description,actions,children,className,testId}:{title?:React.ReactNode;description?:React.ReactNode;actions?:React.ReactNode;children:React.ReactNode;className?:string;testId?:string}){
 return <section data-testid={testId} className={cn('min-w-0 overflow-hidden rounded-xl border border-border bg-card',className)}>{(title||actions)&&<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div className="min-w-0">{title&&<h2 className="text-16 font-semibold">{title}</h2>}{description&&<div className="mt-1 text-12 text-muted-foreground">{description}</div>}</div>{actions&&<div className="flex flex-wrap items-center gap-2">{actions}</div>}</div>}{children}</section>;
}
