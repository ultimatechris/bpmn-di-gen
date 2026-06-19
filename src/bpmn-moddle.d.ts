declare module 'bpmn-moddle' {
  export default class BpmnModdle {
    constructor(packages?: Record<string, unknown>);
    create(type: string, attrs?: Record<string, unknown>): any;
    fromXML(xml: string, typeName?: string): Promise<{ rootElement: any; warnings: any[] }>;
    toXML(element: any, options?: { format?: boolean; preamble?: boolean }): Promise<{ xml: string }>;
  }
}
