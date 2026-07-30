/**
 * Barrel that pulls in every diagram plugin so they self-register.
 * Importing this module is what activates er/gantt/pie/... support.
 */
import './er';
import './mindmap';
import './gitgraph';
import './gantt';
import './journey';
import './timeline';
import './pie';
import './quadrant';
import './xychart';
import './persona';
import './usecase';
import './templates-strategy';
import './templates-user';
import './templates-story';

export * from './registry';
