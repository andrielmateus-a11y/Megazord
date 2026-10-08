// Contrato de fornecedores de dados cadastrais. Permite trocar/adicionar fornecedores no futuro.
//   DataProvider
//     ├── CasaDosDadosProvider
//     └── ReceitaProvider (BrasilAPI / ReceitaWS)

export interface CompanySearchFilters {
  uf?: string;
  municipio?: string;
  bairro?: string;
  cnaes: string[];
  situacao: string;
  portes: string[];
  /** Tempo desde a abertura, em meses. */
  minAgeMonths?: number;
  maxAgeMonths?: number;
  onlyWithMobile?: boolean;
  limit: number;
}

export interface PhoneRecord {
  phone: string;
  type: 'celular' | 'fixo' | 'desconhecido';
}

export interface PartnerRecord {
  name: string;
  role: string | null;
}

export interface CompanyRecord {
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacao: string | null;
  cnae: string | null;
  cnaeDescricao: string | null;
  dataAbertura: string | null;
  porte: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  phones: PhoneRecord[];
  partners: PartnerRecord[];
  /** true quando o fornecedor devolveu o quadro societário/telefones (consulta detalhada). */
  detailed: boolean;
  raw: unknown;
}

export interface SearchPage {
  total: number | null;
  items: CompanyRecord[];
  hasMore: boolean;
}

export interface DataProvider {
  readonly name: string;
  search(filters: CompanySearchFilters, page: number, apiKey: string): Promise<SearchPage>;
  /** null = empresa não encontrada (≠ erro, que lança IntegrationError). */
  getCompany(cnpj: string, apiKey: string): Promise<CompanyRecord | null>;
  checkConnection(apiKey: string): Promise<{ ok: boolean; balance: number | null; message: string }>;
}
