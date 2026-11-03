import type { DetailedHTMLProps, HTMLAttributes } from "react";

// PayPal JS SDK v6 registers <paypal-button> as a custom element.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        type?: string;
        hidden?: boolean;
      };
    }
  }
}
