export type AlertOption = "0" | "5" | "10" | "15" | "30" | "60" | "120" | "1440" | "none";
export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type AppointmentKind = "compromisso" | "tarefa";
export type AppointmentBaseType = AppointmentKind | "medico";
export type Priority = "baixa" | "normal" | "alta" | "urgente";
export type View = "day" | "week" | "tasks" | "month" | "year" | "contacts" | "notes";

export interface Appointment {
  id: string;
  user_id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  descricao: string;
  local: string;
  categoria: string;
  categoria_id?: string | null;
  cor: string;
  tipo: AppointmentKind;
  tipo_personalizado?: string | null;
  prioridade: Priority;
  cliente: string;
  responsavel: string;
  alerta_minutos: number | null;
  alertas?: AppointmentReminder[];
  atrasado_notificado_em?: string | null;
  recorrencia: Recurrence;
  concluido: boolean;
  alerta_enviado_em: string | null;
  alerta_enviado_para: string | null;
  adiado_ate: string | null;
  created_at: string;
}

export interface AppointmentReminder {
  minutos: number;
  disparado_em: string | null;
  disparado_para?: string | null;
  adiado_ate: string | null;
  disparos?: { data: string; disparado_em: string; adiado_ate: string | null }[];
}

export interface AgendaCategory {
  id: string;
  user_id: string;
  nome: string;
  cor: string;
  created_at?: string;
}

export interface AgendaAppointmentType {
  id: string;
  user_id: string;
  nome: string;
  tipo_base?: AppointmentBaseType | null;
  created_at?: string;
}

export interface Observation {
  id: string;
  user_id: string;
  data: string;
  anotacao: string;
}

export interface FreeNote {
  id: string;
  user_id: string;
  titulo: string;
  conteudo: string;
  cor: string;
  fixada: boolean;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  nome: string;
  email: string;
  empresa: string;
  endereco: string;
  aniversario: string | null;
  observacoes: string;
  favorito: boolean;
  deleted_at: string | null;
  telefones?: Phone[];
}

export interface Phone {
  id?: string;
  numero: string;
  rotulo: "celular" | "casa" | "trabalho";
}
