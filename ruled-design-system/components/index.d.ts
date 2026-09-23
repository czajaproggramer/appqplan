import type * as React from 'react';
/** A sheet of paper. Ruled lines and the red margin line are on by default. */
export interface PaperProps extends React.HTMLAttributes<HTMLElement> { ruled?: boolean; margin?: boolean; stacked?: boolean; children?: React.ReactNode }
export declare function Paper(props: PaperProps): React.ReactElement;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'quiet' | 'ghost'; icon?: 'plus' | 'trash' | 'settings'; children?: React.ReactNode }
export declare function Button(props: ButtonProps): React.ReactElement;
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> { checked?: boolean; defaultChecked?: boolean; label?: React.ReactNode; onChange?: (checked: boolean, event: React.ChangeEvent<HTMLInputElement>) => void }
export declare function Checkbox(props: CheckboxProps): React.ReactElement;
export interface TaskProps { done?: boolean; onToggle?: (done: boolean) => void; onDelete?: () => void; meta?: React.ReactNode; children: React.ReactNode; className?: string }
export declare function Task(props: TaskProps): React.ReactElement;
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export declare function Input(props: InputProps): React.ReactElement;
export interface ScheduleEvent { start: string | number; end: string | number; title: string; tone?: 'yellow' | 'peach' | 'sage' }
export interface ScheduleProps { start?: number; end?: number; events?: ScheduleEvent[]; now?: string | number; className?: string }
export declare function Schedule(props: ScheduleProps): React.ReactElement;
export declare function Icon(props: { name: 'plus' | 'trash' | 'settings' }): React.ReactElement;
declare global { interface Window { Ruled: { Paper: typeof Paper; Button: typeof Button; Checkbox: typeof Checkbox; Task: typeof Task; Input: typeof Input; Schedule: typeof Schedule; Icon: typeof Icon } } }
