/**
 * @file Angular Parser Tests
 * @description Unit tests for Angular component parser.
 * Per spec Phase 6: Scanner Tests (T102)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AngularParser } from "../../../src/parsers/angular-parser";

describe("AngularParser", () => {
  let parser: AngularParser;

  beforeEach(() => {
    parser = new AngularParser();
  });

  describe("parseSource", () => {
    it("should parse a basic Angular component", () => {
      const source = `
        import { Component } from '@angular/core';

        @Component({
          selector: 'app-button',
          templateUrl: './button.component.html',
          styleUrls: ['./button.component.scss']
        })
        export class ButtonComponent {
        }
      `;

      const result = parser.parseSource(source, "button.component.ts");

      expect(result.errors).toHaveLength(0);
      expect(result.components).toHaveLength(1);

      const button = result.components[0];
      expect(button.name).toBe("ButtonComponent");
      expect(button.selector).toBe("app-button");
      expect(button.templateUrl).toBe("./button.component.html");
      expect(button.styleUrls).toContain("./button.component.scss");
    });

    it("should parse @Input decorators", () => {
      const source = `
        import { Component, Input } from '@angular/core';

        @Component({
          selector: 'app-card',
          template: '<div>{{title}}</div>'
        })
        export class CardComponent {
          @Input() title: string = '';
          @Input({ required: true }) subtitle!: string;
          @Input('cardType') type: 'default' | 'featured' = 'default';
        }
      `;

      const result = parser.parseSource(source, "card.component.ts");

      expect(result.components).toHaveLength(1);
      const card = result.components[0];
      expect(card.inputs).toHaveLength(3);

      const titleInput = card.inputs.find((i) => i.name === "title");
      expect(titleInput).toBeDefined();
      expect(titleInput?.type).toBe("string");
      expect(titleInput?.defaultValue).toBe("''");

      const subtitleInput = card.inputs.find((i) => i.name === "subtitle");
      expect(subtitleInput).toBeDefined();
      expect(subtitleInput?.required).toBe(true);

      const typeInput = card.inputs.find((i) => i.name === "type");
      expect(typeInput).toBeDefined();
      expect(typeInput?.alias).toBe("cardType");
    });

    it("should parse @Output decorators", () => {
      const source = `
        import { Component, Output, EventEmitter } from '@angular/core';

        @Component({
          selector: 'app-search',
          template: '<input (change)="onSearch($event)">'
        })
        export class SearchComponent {
          @Output() search = new EventEmitter<string>();
          @Output('searchComplete') complete = new EventEmitter<void>();
        }
      `;

      const result = parser.parseSource(source, "search.component.ts");

      expect(result.components).toHaveLength(1);
      const search = result.components[0];
      expect(search.outputs).toHaveLength(2);

      const searchOutput = search.outputs.find((o) => o.name === "search");
      expect(searchOutput).toBeDefined();
      expect(searchOutput?.type).toContain("EventEmitter");

      const completeOutput = search.outputs.find((o) => o.name === "complete");
      expect(completeOutput).toBeDefined();
      expect(completeOutput?.alias).toBe("searchComplete");
    });

    it("should parse standalone components", () => {
      const source = `
        import { Component } from '@angular/core';
        import { CommonModule } from '@angular/common';

        @Component({
          selector: 'app-standalone',
          standalone: true,
          imports: [CommonModule],
          template: '<p>Standalone!</p>'
        })
        export class StandaloneComponent {
        }
      `;

      const result = parser.parseSource(source, "standalone.component.ts");

      expect(result.components).toHaveLength(1);
      const standalone = result.components[0];
      expect(standalone.standalone).toBe(true);
      expect(standalone.imports).toContain("CommonModule");
    });

    it("should parse directives", () => {
      const source = `
        import { Directive, Input, HostBinding } from '@angular/core';

        @Directive({
          selector: '[appHighlight]',
          standalone: true
        })
        export class HighlightDirective {
          @Input() appHighlight: string = 'yellow';
          
          @HostBinding('style.backgroundColor')
          get backgroundColor() {
            return this.appHighlight;
          }
        }
      `;

      const result = parser.parseSource(source, "highlight.directive.ts");

      expect(result.directives).toHaveLength(1);
      const directive = result.directives[0];
      expect(directive.name).toBe("HighlightDirective");
      expect(directive.selector).toBe("[appHighlight]");
      expect(directive.standalone).toBe(true);
    });

    it("should parse services", () => {
      const source = `
        import { Injectable } from '@angular/core';
        import { HttpClient } from '@angular/common/http';
        import { Observable } from 'rxjs';

        @Injectable({
          providedIn: 'root'
        })
        export class UserService {
          constructor(private http: HttpClient) {}

          getUsers(): Observable<User[]> {
            return this.http.get<User[]>('/api/users');
          }

          getUserById(id: string): Observable<User> {
            return this.http.get<User>(\`/api/users/\${id}\`);
          }
        }
      `;

      const result = parser.parseSource(source, "user.service.ts");

      expect(result.services).toHaveLength(1);
      const service = result.services[0];
      expect(service.name).toBe("UserService");
      expect(service.providedIn).toBe("root");
      expect(service.methods).toContain("getUsers");
      expect(service.methods).toContain("getUserById");
    });

    it("should handle inline templates", () => {
      const source = `
        import { Component } from '@angular/core';

        @Component({
          selector: 'app-inline',
          template: \`
            <div class="container">
              <h1>{{ title }}</h1>
              <p>{{ description }}</p>
            </div>
          \`,
          styles: [\`
            .container { padding: 1rem; }
          \`]
        })
        export class InlineComponent {
          title = 'Hello';
          description = 'World';
        }
      `;

      const result = parser.parseSource(source, "inline.component.ts");

      expect(result.components).toHaveLength(1);
      const inline = result.components[0];
      expect(inline.template).toContain("container");
      expect(inline.templateUrl).toBeUndefined();
    });

    it("should detect changeDetection strategy", () => {
      const source = `
        import { Component, ChangeDetectionStrategy } from '@angular/core';

        @Component({
          selector: 'app-optimized',
          template: '<p>Optimized</p>',
          changeDetection: ChangeDetectionStrategy.OnPush
        })
        export class OptimizedComponent {
        }
      `;

      const result = parser.parseSource(source, "optimized.component.ts");

      expect(result.components).toHaveLength(1);
      const optimized = result.components[0];
      expect(optimized.changeDetection).toBe("OnPush");
    });

    it("should handle signal inputs (Angular 17+)", () => {
      const source = `
        import { Component, input, output } from '@angular/core';

        @Component({
          selector: 'app-modern',
          template: '<p>{{ name() }}</p>'
        })
        export class ModernComponent {
          name = input<string>('');
          required = input.required<number>();
          clicked = output<void>();
        }
      `;

      const result = parser.parseSource(source, "modern.component.ts");

      expect(result.components).toHaveLength(1);
      // Signal inputs should be detected
    });
  });

  describe("parseFiles", () => {
    it("should handle non-existent files gracefully", () => {
      const result = parser.parseFiles(["/non/existent/file.component.ts"]);

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
