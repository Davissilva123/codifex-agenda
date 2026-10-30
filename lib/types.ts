export type AlertOption = "5" | "10" | "15" | "30" | "60" | "1440" | "none";
export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type AppointmentKind = "compromisso" | "tarefa";
export type Priority = "baixa" | "normal" | "alta" | "urgente";

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
  cor: string;
  tipo: AppointmentKind;
  prioridade: Priority;
  cliente: string;
  alerta_minutos: number | null;
  recorrencia: Recurrence;
  concluido: boolean;
  alerta_enviado_em: string | null;
  alerta_enviado_para: string | null;
  adiado_ate: string | null;
  created_at: string;
}

export interface Observation { id: string; user_id: string; data: string; anotacao: string; }
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
  telefones?: Phone[];
}
export interface Phone { id?: string; numero: string; rotulo: "celular" | "casa" | "trabalho"; }
